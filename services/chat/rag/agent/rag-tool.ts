// ---------------------------------------------------------------
// RAG 工具包装 — 把 ragAsk 检索+生成能力包装成 LangChain Tool
//
// 集成到第九章 Functional Expert 的工具池，并在工具入口接入
// 第十章的预算控制（resolveBudgetAction）。预算检查放在最前，
// 避免调用昂贵的 ragAsk 之后才发现超预算。
//
// 关键约束：
//   - LangChain 工具返回必须是 string，统一用 JSON.stringify 序列化。
//   - 本模块不依赖 src/llm/ 下的具体实现，通过 deps 注入，
//     便于单测 mock ragAsk 与 resolveBudgetAction。
// ---------------------------------------------------------------

import { tool, StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

// ================================================================
// 类型定义
// ================================================================

/** ragAsk 的返回结构（11.6 rag-pipeline） */
export interface RagAskResult {
  answer: string;
  citations: unknown[];
}

/** 预算动作 — 与 src/llm/cost/budget-policy.ts 的 BudgetAction 对齐 */
export type BudgetAction = 'allow' | 'downgrade' | 'reject';

/** 预算决策结果 — 与 BudgetPolicyResult 结构对齐 */
export interface BudgetDecision {
  action: BudgetAction;
  reason: string;
}

/** createRagTool 的依赖注入 */
export interface RagToolDeps {
  /** RAG 问答：检索 + 生成，返回 { answer, citations } */
  ragAsk: (question: string, topK?: number) => Promise<RagAskResult>;
  /** 预算检查：决定 allow / downgrade / reject */
  resolveBudgetAction: (input: {
    budgetUsedPercent: number;
    agentName: string;
  }) => BudgetDecision;
  /** 当月预算消耗百分比（0-100+），透传给 resolveBudgetAction */
  budgetUsedPercent: number;
  /** 预算决策所用的 Agent 角色名，默认 functional_expert */
  agentName?: string;
}

// ================================================================
// 工具描述（11.10.2）
// ================================================================

const RAG_TOOL_NAME = 'rag_ask';

const RAG_TOOL_DESCRIPTION =
  '基于内部知识库的检索增强问答（RAG）：先检索相关文档片段，再生成带引用出处的回答。' +
  '适用场景：需要依据内部文档、需求规范、历史资料等知识库内容回答事实性问题，' +
  '或回答必须附带出处 / 引用来源时。' +
  '不适用场景：日常寒暄、闲聊、常识问答、代码翻译，以及可用模型自身通用知识回答、' +
  '且无需引用来源的问题。仅当问题确实需要检索知识库内容时才调用，避免无谓的检索开销。';

// ================================================================
// createRagTool
// ================================================================

/**
 * 创建 RAG 工具。
 *
 * 执行流程：
 *   1. 预算检查（最前）—— resolveBudgetAction 返回 reject 时，
 *      直接返回 { error: 'budget_exceeded' }，不调用 ragAsk。
 *   2. 否则调用 ragAsk(question, topK)。
 *   3. 将结果 JSON.stringify 后作为字符串返回。
 *
 * @returns StructuredTool（LangChain 工具，返回 string）
 */
export function createRagTool(deps: RagToolDeps): StructuredTool {
  const {
    ragAsk,
    resolveBudgetAction,
    budgetUsedPercent,
    agentName = 'functional_expert',
  } = deps;

  return tool(
    async ({ question, topK }: { question: string; topK?: number }) => {
      // ---- Step 1: 预算检查（放在最前，避免超预算后仍执行昂贵检索）----
      const decision = resolveBudgetAction({ budgetUsedPercent, agentName });

      if (decision.action === 'reject') {
        return JSON.stringify({
          error: 'budget_exceeded',
          reason: decision.reason,
        });
      }

      // ---- Step 2: 检索 + 生成 ----
      const result = await ragAsk(question, topK);

      // ---- Step 3: 序列化为字符串返回 ----
      return JSON.stringify(result);
    },
    {
      name: RAG_TOOL_NAME,
      description: RAG_TOOL_DESCRIPTION,
      schema: z.object({
        question: z.string().describe('要检索知识库并回答的问题'),
        topK: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('检索返回的文档片段数量，默认 5'),
      }),
    },
  );
}
