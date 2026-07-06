/**
 * pipeline-graph.ts — 第 9.5 节：Plan-and-Execute 外层流水线 + Reflexion
 *
 * 用于处理跨工单的联合分析场景：
 *   单次 analysisGraph 分析一个需求，pipeline 把一个"大任务"拆成多个步骤，
 *   每一步调用一次完整的 analysisGraph，最后合并评估，不达标则反思重跑。
 *
 * 与 analysisGraph 的关系：
 *   - analysisGraph（9.2/9.3）：处理单条需求，内部 Supervisor + 多专家
 *   - pipelineGraph（9.5）：包裹 analysisGraph，处理多步骤联合分析
 *   - 简单需求直接调 analysisGraph，复杂跨工单场景用 pipelineGraph
 *
 * 图结构：
 *   START → planner → executor → evaluator
 *              ↑                      │
 *              └── reflector ←────────┘ (不通过时，最多 1 次)
 *                       │
 *                       └── (通过) → END
 *
 * 运行方式：bun run services/chat/src/llm/graph/pipeline-graph.ts
 */

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { z } from 'zod';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createChatModel } from '../model.factory';
import { createAnalysisGraph } from './requirement-analysis-graph';

// ---------------------------------------------------------------
// Module-level singletons — 避免重复创建
// ---------------------------------------------------------------
const defaultModel = createChatModel();
const analysisGraph = createAnalysisGraph();

// ===============================================================
// Types
// ===============================================================

/** 计划步骤 */
interface PlanStep {
  id: number;
  description: string;
  done: boolean;
}

/** 单步执行结果 */
interface StepResult {
  stepId: number;
  description: string;
  report: string;
  intent?: string;
  activeExperts?: string[];
  error?: string;
}

/** 反思记录 */
interface Reflection {
  attempt: number;
  failures: string[];
  suggestedFixes: string[];
}

// ===============================================================
// PipelineState
// ===============================================================

const PipelineState = Annotation.Root({
  /** 原始大任务描述 */
  input: Annotation<string>,

  /** 拆解后的步骤计划 */
  plan: Annotation<PlanStep[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  /** 当前执行到第几步（索引） */
  currentStepIndex: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  /** 所有步骤的执行结果，key = stepId */
  stepResults: Annotation<Record<string, StepResult>>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),

  /** 反思记录 */
  reflections: Annotation<Reflection[]>({
    reducer: (prev, next) => next,
    default: () => [],
  }),

  /** Reflexion 重试次数（硬上限 1） */
  retryCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  /** 父线程 ID，子步骤的 thread_id 格式：${parentThreadId}:step-${index} */
  parentThreadId: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),

  /** 最终报告 */
  finalReport: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),

  /** evaluator 评估是否通过 */
  evalPassed: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),

  /** evaluator 质量评分 0-100 */
  evalScore: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
});

type PipelineStateType = typeof PipelineState.State;

// ===============================================================
// System prompts
// ===============================================================

const PLANNER_SYSTEM_PROMPT = `你是一名**项目计划专家**。你的任务是将一个复杂的联合需求拆解为可独立执行的步骤。

## 拆解原则
1. 每一步应该是**独立的**，可以由 analysisGraph 单独处理
2. 步骤粒度适中：不要太细（如"打开文件"），也不要太粗（整个任务一步）
3. 步骤之间有**逻辑顺序**：先分析核心功能，再分析扩展需求
4. 通常 2-4 步为佳

## 输出格式（纯 JSON，不要 markdown 包裹）
{
  "steps": [
    { "id": 0, "description": "步骤描述（会被作为 analysisGraph 的 input）" },
    { "id": 1, "description": "步骤描述" }
  ],
  "reasoning": "拆解理由（2-3 句话）"
}

请直接输出 JSON。`;

const EVALUATOR_SYSTEM_PROMPT = `你是一名**质量评估专家**。你需要先合并各步骤结果为一份完整报告，然后评估这份报告的质量。

## 第一步：合并报告
按以下结构（Markdown）生成最终报告：
# 联合需求分析报告
## 1. 总体概述
## 2. 各步骤分析结果（包含失败步骤，标注"执行失败"及原因）
## 3. 跨步骤依赖分析
## 4. 综合风险评估
## 5. 改进建议（按优先级排序）
## 6. 总结与下一步

## 第二步：评估质量
**评估标准**：
1. **完整性**：每个步骤（含失败的）的分析结果都被纳入总报告
2. **一致性**：不同步骤的结论之间没有矛盾
3. **可操作性**：报告中有具体的改进建议，而非空泛描述
4. **结构性**：报告结构清晰，章节完整

**打分规则**：
- 90-100：优秀，可直接交付
- 80-89：良好，个别点需补充
- 60-79：一般，存在明显缺失
- 0-59：不合格，需要重新分析

## 输出格式（纯 JSON，不要 markdown 包裹）
{
  "finalReport": "完整的 Markdown 报告",
  "pass": true/false,
  "score": 0-100,
  "issues": ["问题1", "问题2"],
  "summary": "评估总结（1-2 句话）"
}

请直接输出 JSON。`;

const REFLECTOR_SYSTEM_PROMPT = `你是一名**反思改进专家**。分析评估不通过的原因，修订计划。

## 分析维度
1. 哪些步骤的输出质量不够？
2. 是否是步骤拆解不合理（粒度太粗/太细）？
3. 是否需要补充遗漏的维度？

## 输出格式（纯 JSON，不要 markdown 包裹）
{
  "failures": ["失败点1", "失败点2"],
  "suggestedFixes": ["改进建议1", "改进建议2"],
  "revisedPlan": [
    { "id": 0, "description": "修订后的步骤描述", "done": false }
  ]
}

**重要**：
- revisedPlan 必须包含**完整**的步骤列表（不是增量）
- 每个步骤的 done 设为 false（全部重跑）
- 如果原计划有 m 步，新计划可以有 m、m+1 或 m-1 步

请直接输出 JSON。`;

// ===============================================================
// Schemas
// ===============================================================

const PlannerSchema = z.object({
  steps: z.array(
    z.object({
      id: z.number().describe('步骤编号，从 0 开始'),
      description: z.string().describe('步骤描述，作为 analysisGraph 的 input'),
    }),
  ),
  reasoning: z.string().describe('拆解理由'),
});

/** evaluator 一阶段输出：合并报告 + 评估 */
const EvaluatorSchema = z.object({
  finalReport: z.string().describe('合并后的完整 Markdown 报告'),
  pass: z.boolean().describe('是否通过评估（score >= 80）'),
  score: z.number().describe('质量评分 0-100'),
  issues: z.array(z.string()).describe('发现的问题'),
  summary: z.string().describe('评估总结（1-2 句话）'),
});

const ReflectorSchema = z.object({
  failures: z.array(z.string()).describe('失败点分析'),
  suggestedFixes: z.array(z.string()).describe('改进建议'),
  revisedPlan: z.array(
    z.object({
      id: z.number(),
      description: z.string(),
      done: z.boolean(),
    }),
  ),
});

// ===============================================================
// Planner node
// ===============================================================

/**
 * 将大任务拆解为有序步骤。
 */
async function plannerNode(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const plannerModel = defaultModel.withStructuredOutput(PlannerSchema);

  try {
    const result = await plannerModel.invoke([
      new SystemMessage(PLANNER_SYSTEM_PROMPT),
      new HumanMessage(
        `## 联合需求任务\n${state.input}\n\n请拆解为可独立执行的步骤。`,
      ),
    ]);

    return {
      plan: result.steps.map((s) => ({ ...s, done: false })),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Planner] 拆解失败，降级为单步:', errorMsg);
    return {
      plan: [{ id: 0, description: state.input, done: false }],
    };
  }
}

// ===============================================================
// Executor node
// ===============================================================

/**
 * 按顺序执行 plan 中每个未完成的步骤。
 *
 * 每个步骤调用一次模块级复用的 analysisGraph.invoke()，
 * 使用独立的 thread_id 实现子任务的独立持久化：
 *   ${parentThreadId}:step-${index}
 *
 * 执行策略：
 * - 读取 plan[currentStepIndex]，调用 analysisGraph
 * - 写回 stepResults，标记 plan[idx].done = true，递增 currentStepIndex
 * - 首次执行时初始化 parentThreadId 并写回 State
 */
async function executorNode(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const plan = state.plan ?? [];
  const idx = state.currentStepIndex ?? 0;

  if (idx >= plan.length) {
    return {};
  }

  const step = plan[idx];
  if (step.done) {
    return { currentStepIndex: idx + 1 };
  }

  const stepResults = { ...(state.stepResults ?? {}) };

  // 初始化 parentThreadId 并写回 State，确保同一次 pipeline 所有步骤共享前缀
  const parentId = state.parentThreadId || `pipeline-${Date.now()}`;

  try {
    const subThreadId = `${parentId}:step-${idx}`;

    const result = await analysisGraph.invoke(
      { input: step.description, messages: [] },
      { configurable: { thread_id: subThreadId } },
    );

    const stepResult: StepResult = {
      stepId: step.id,
      description: step.description,
      report: result.summary ?? '',
      intent: result.intent ?? 'analyze',
      activeExperts: result.activeExperts ?? [],
    };

    stepResults[String(step.id)] = stepResult;

    // 标记当前步骤完成
    const updatedPlan = plan.map((s, i) =>
      i === idx ? { ...s, done: true } : s,
    );

    return {
      stepResults,
      currentStepIndex: idx + 1,
      plan: updatedPlan,
      parentThreadId: parentId,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Executor] 步骤 ${step.id} 失败:`, errorMsg);

    stepResults[String(step.id)] = {
      stepId: step.id,
      description: step.description,
      report: '',
      error: errorMsg,
    };

    const updatedPlan = plan.map((s, i) =>
      i === idx ? { ...s, done: true } : s,
    );

    return {
      stepResults,
      currentStepIndex: idx + 1,
      plan: updatedPlan,
      parentThreadId: parentId,
    };
  }
}

// ===============================================================
// Evaluator node
// ===============================================================

/**
 * 合并所有步骤结果（含失败步骤）为最终报告，并评估质量。
 *
 * 一次 LLM 调用同时完成"报告生成 + 质量评估"，
 * 结果写入 finalReport、evalPassed、evalScore。
 */
async function evaluatorNode(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const stepResults = state.stepResults ?? {};

  try {
    // 构建完整的步骤摘要（含失败步骤，不截断）
    const allSteps = Object.values(stepResults);
    const stepSummaries = allSteps
      .map((r) => {
        if (r.error) {
          return (
            `### 步骤 ${r.stepId}: ${r.description}\n\n` +
            `**状态：执行失败**\n错误信息：${r.error}\n`
          );
        }
        return `### 步骤 ${r.stepId}: ${r.description}\n\n${r.report}`;
      })
      .join('\n\n---\n\n');

    const evaluatorModel = defaultModel.withStructuredOutput(EvaluatorSchema);

    const result = await evaluatorModel.invoke([
      new SystemMessage(EVALUATOR_SYSTEM_PROMPT),
      new HumanMessage(
        `## 原始任务\n${state.input}\n\n` +
          `## 各步骤分析结果\n\n${stepSummaries}\n\n` +
          `请合并为完整报告并评估质量。`,
      ),
    ]);

    console.log(
      `[Evaluator] pass=${result.pass}, score=${result.score}, issues=${result.issues.length}`,
    );

    return {
      finalReport: result.finalReport,
      evalPassed: result.pass,
      evalScore: result.score,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Evaluator] 评估失败，降级拼接:', errorMsg);

    // 降级：直接拼接 step results（含失败步骤）
    const fallbackReport = Object.values(stepResults)
      .map((r) => {
        if (r.error) {
          return `## 步骤 ${r.stepId}: ${r.description}\n\n**执行失败**：${r.error}`;
        }
        return `## 步骤 ${r.stepId}: ${r.description}\n\n${r.report}`;
      })
      .join('\n\n---\n\n');

    return {
      finalReport: `# 联合需求分析报告\n\n⚠️ 评估节点异常，已降级拼接\n\n${fallbackReport}`,
      evalPassed: false,
      evalScore: 0,
    };
  }
}

// ===============================================================
// Reflector node
// ===============================================================

/**
 * 反思不通过的原因，修订计划。
 *
 * - 读取评估结果（不截断 finalReport）
 * - 生成修订后的完整 plan
 * - **代码层强制 done: false**（不依赖 LLM 遵循指令）
 * - 递增 retryCount
 */
async function reflectorNode(
  state: PipelineStateType,
): Promise<Partial<PipelineStateType>> {
  const reflectorModel = defaultModel.withStructuredOutput(ReflectorSchema);

  try {
    const stepSummary = Object.values(state.stepResults ?? {})
      .map(
        (r) =>
          `步骤 ${r.stepId} (${r.description}): ${r.error ? '失败 - ' + r.error : `完成，评分 ${state.evalScore}`}`,
      )
      .join('\n');

    const result = await reflectorModel.invoke([
      new SystemMessage(REFLECTOR_SYSTEM_PROMPT),
      new HumanMessage(
        `## 原始任务\n${state.input}\n\n` +
          `## 当前计划\n${JSON.stringify(state.plan, null, 2)}\n\n` +
          `## 各步骤执行情况\n${stepSummary}\n\n` +
          `## 当前报告\n${state.finalReport}\n\n` +
          `## 评估结果\n` +
          `- pass: ${state.evalPassed}\n` +
          `- score: ${state.evalScore}\n\n` +
          `请分析失败原因并给出修订后的完整计划。`,
      ),
    ]);

    const reflections: Reflection[] = [
      ...(state.reflections ?? []),
      {
        attempt: (state.retryCount ?? 0) + 1,
        failures: result.failures,
        suggestedFixes: result.suggestedFixes,
      },
    ];

    console.log(
      `[Reflector] retry #${(state.retryCount ?? 0) + 1}, ` +
        `failures=${result.failures.length}, ` +
        `revisedPlanSteps=${result.revisedPlan.length}`,
    );

    return {
      // 代码层强制 done: false，不依赖 LLM 遵守 prompt 指令
      plan: result.revisedPlan.map((s) => ({ ...s, done: false })),
      currentStepIndex: 0,
      stepResults: {},
      reflections,
      retryCount: (state.retryCount ?? 0) + 1,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Reflector] 反思失败，终止:', errorMsg);

    return {
      retryCount: (state.retryCount ?? 0) + 1,
      reflections: [
        ...(state.reflections ?? []),
        {
          attempt: (state.retryCount ?? 0) + 1,
          failures: [`Reflector 降级: ${errorMsg}`],
          suggestedFixes: ['人工复核'],
        },
      ],
    };
  }
}

// ===============================================================
// Conditional routing
// ===============================================================

/**
 * executor 完成当前步骤后：
 *   还有未完成步骤 → executor (继续)
 *   全部完成        → evaluator
 */
function routeAfterExecutor(
  state: PipelineStateType,
): 'evaluator' | 'executor' {
  const idx = state.currentStepIndex ?? 0;
  const plan = state.plan ?? [];
  return idx >= plan.length ? 'evaluator' : 'executor';
}

/**
 * evaluator 完成后：
 *   - 通过（evalPassed=true 或 evalScore>=80）→ END
 *   - 不通过 + 未达重试上限            → reflector → executor
 *   - 不通过 + 已达重试上限 (>=1)      → END（强制终止）
 */
function routeAfterEvaluator(
  state: PipelineStateType,
): 'reflector' | typeof END {
  const passed = state.evalPassed || (state.evalScore ?? 0) >= 80;

  if (passed) {
    console.log(`[Pipeline] 评估通过 (score=${state.evalScore})，结束`);
    return END;
  }

  if ((state.retryCount ?? 0) >= 1) {
    console.log(
      `[Pipeline] 评估未通过但已达重试上限 (retry=${state.retryCount})，强制结束`,
    );
    return END;
  }

  console.log(`[Pipeline] 评估未通过 (score=${state.evalScore})，进入反思`);
  return 'reflector';
}

// ===============================================================
// Pipeline graph factory
// ===============================================================

/**
 * 创建 Plan-and-Execute + Reflexion 外层流水线图。
 *
 * 图结构：
 *   START → planner → executor ⇄ executor (循环所有步骤)
 *                        │
 *                        └(全部完成)→ evaluator
 *                                       ├(通过)→ END
 *                                       └(不通过)→ reflector → executor
 */
export function createPipelineGraph() {
  return new StateGraph(PipelineState)
    .addNode('planner', plannerNode)
    .addNode('executor', executorNode as any)
    .addNode('evaluator', evaluatorNode)
    .addNode('reflector', reflectorNode)
    .addEdge(START, 'planner')
    .addEdge('planner', 'executor')
    .addConditionalEdges('executor', routeAfterExecutor, {
      executor: 'executor',
      evaluator: 'evaluator',
    })
    .addConditionalEdges('evaluator', routeAfterEvaluator, {
      reflector: 'reflector',
      [END]: END,
    } as any)
    .addEdge('reflector', 'executor')
    .compile();
}

// ===============================================================
// Run helper
// ===============================================================

export interface PipelineResult {
  status: 'completed' | 'partial' | 'failed';
  plan: PlanStep[];
  stepResults: Record<string, StepResult>;
  reflections: Reflection[];
  retryCount: number;
  finalReport: string;
  evalPassed: boolean;
  evalScore: number;
}

/**
 * 运行 Plan-and-Execute 流水线。
 *
 * @param input           大任务描述（如"分析以下 3 个需求的关联影响..."）
 * @param parentThreadId  父线程 ID（用于子步骤的 thread_id 命名空间）
 */
export async function runPipeline(
  input: string,
  parentThreadId?: string,
): Promise<PipelineResult> {
  const normalizedInput = input.trim();

  if (!normalizedInput) {
    return {
      status: 'failed',
      plan: [],
      stepResults: {},
      reflections: [],
      retryCount: 0,
      finalReport: 'input 不能为空',
      evalPassed: false,
      evalScore: 0,
    };
  }

  try {
    const graph = createPipelineGraph();
    const state = await graph.invoke({
      input: normalizedInput,
      plan: [],
      currentStepIndex: 0,
      stepResults: {},
      reflections: [],
      retryCount: 0,
      parentThreadId: parentThreadId ?? '',
      finalReport: '',
      evalPassed: false,
      evalScore: 0,
    });

    return {
      status: state.evalPassed ? 'completed' : 'partial',
      plan: state.plan ?? [],
      stepResults: state.stepResults ?? {},
      reflections: state.reflections ?? [],
      retryCount: state.retryCount ?? 0,
      finalReport: state.finalReport ?? '',
      evalPassed: state.evalPassed ?? false,
      evalScore: state.evalScore ?? 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'failed',
      plan: [],
      stepResults: {},
      reflections: [],
      retryCount: 0,
      finalReport: `# 流水线执行失败\n\n错误：${message}`,
      evalPassed: false,
      evalScore: 0,
    };
  }
}

// ===============================================================
// Simple run: 仅 planner → executor，不做评估和反思
// ===============================================================

/**
 * 简化版：仅拆解 + 执行，不做评估和反思。
 *
 * 用于只需要多步骤执行但不需要质量把关的场景。
 */
export async function runPipelineSimple(
  input: string,
  parentThreadId?: string,
): Promise<PipelineResult> {
  const normalizedInput = input.trim();

  if (!normalizedInput) {
    return {
      status: 'failed',
      plan: [],
      stepResults: {},
      reflections: [],
      retryCount: 0,
      finalReport: 'input 不能为空',
      evalPassed: false,
      evalScore: 0,
    };
  }

  try {
    const plannerModel = defaultModel.withStructuredOutput(PlannerSchema);

    // 拆解
    const planResult = await plannerModel.invoke([
      new SystemMessage(PLANNER_SYSTEM_PROMPT),
      new HumanMessage(
        `## 联合需求任务\n${normalizedInput}\n\n请拆解为可独立执行的步骤。`,
      ),
    ]);

    const plan: PlanStep[] = planResult.steps.map((s) => ({
      ...s,
      done: false,
    }));
    const stepResults: Record<string, StepResult> = {};
    const pid = parentThreadId ?? `pipeline-${Date.now()}`;

    // 逐步执行
    for (const step of plan) {
      try {
        const result = await analysisGraph.invoke(
          { input: step.description, messages: [] },
          { configurable: { thread_id: `${pid}:step-${step.id}` } },
        );

        stepResults[String(step.id)] = {
          stepId: step.id,
          description: step.description,
          report: result.summary ?? '',
          intent: result.intent ?? 'analyze',
        };
      } catch (err) {
        stepResults[String(step.id)] = {
          stepId: step.id,
          description: step.description,
          report: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // 拼接报告（含失败步骤）
    const finalReport = Object.values(stepResults)
      .map((r) => {
        if (r.error) {
          return `## 步骤 ${r.stepId}: ${r.description}\n\n**执行失败**：${r.error}`;
        }
        return `## 步骤 ${r.stepId}: ${r.description}\n\n${r.report}`;
      })
      .join('\n\n---\n\n');

    return {
      status: 'completed',
      plan,
      stepResults,
      reflections: [],
      retryCount: 0,
      finalReport: `# 联合需求分析报告\n\n${finalReport}`,
      evalPassed: true,
      evalScore: 80,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'failed',
      plan: [],
      stepResults: {},
      reflections: [],
      retryCount: 0,
      finalReport: `# 流水线执行失败\n\n错误：${message}`,
      evalPassed: false,
      evalScore: 0,
    };
  }
}
