import {
  StateGraph,
  Annotation,
  START,
  END,
  MessagesAnnotation,
} from '@langchain/langgraph';
import { z } from 'zod';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createChatModel } from '../model.factory';
import {
  extractAgent,
  clarifyAgent,
  analysisAgent,
  riskAgent,
  summaryAgent,
} from '../agents/sub-agents';

// ---------------------------------------------------------------
// JSON parse helper
// ---------------------------------------------------------------
const parseJson = <T>(raw: string, fallback: T): T => {
  try {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    return JSON.parse(match ? match[1].trim() : raw.trim());
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------
// Typed fallbacks
// ---------------------------------------------------------------

const EXTRACT_FALLBACK = {
  title: '',
  action: '',
  constraints: [] as string[],
  entities: [] as string[],
  priority: 'medium',
  background: '',
};

const CLARIFY_FALLBACK = {
  needsClarification: false,
  questions: [] as string[],
  reason: 'JSON 解析失败，已降级为跳过澄清阶段',
};

const ANALYSIS_FALLBACK = {
  functionalDecomposition: [] as {
    name: string;
    description: string;
    complexity: string;
  }[],
  userStories: [] as string[],
  acceptanceCriteria: [] as { module: string; criterion: string }[],
  dependencies: [] as {
    target: string;
    type: string;
    impact: string;
  }[],
  suggestions: ['⚠️ 分析 Agent 输出异常，已采用空分析继续流程，请人工复核'],
};

const RISK_FALLBACK = {
  risks: [] as {
    category: string;
    description: string;
    likelihood: string;
    severity: string;
    mitigation: string;
  }[],
  overallRiskLevel: 'unknown' as string,
  summary: '⚠️ 风险 Agent 输出异常，已跳过风险评估',
};

// ---------------------------------------------------------------
// Intent classification — Zod schema + keyword fallback
// ---------------------------------------------------------------

const IntentSchema = z.object({
  intent: z.enum(['analyze', 'query', 'chat']),
  reasoning: z.string(),
});

type ClassifiedIntent = z.infer<typeof IntentSchema>;

/** 系统提示词：意图分类规则 */
const CLASSIFIER_SYSTEM_PROMPT = `你是一个需求意图分类器。分析用户输入，判断其属于以下三类之一：

## 1. analyze（需求分析）
用户想要对某个需求进行结构化分析、拆解、评估。
关键特征：
- 描述了一个待实现的功能或系统（如"开发一个登录功能"、"做一个问卷系统"）
- 包含功能描述、约束条件、业务场景等需求要素
- 请求对需求进行"分析"、"拆解"、"评审"
- 示例：
  - "分析需求：开发在线问卷系统，支持多种题型"
  - "我需要一个用户登录功能"
  - "帮我评估这个需求的技术风险"
  - "看看这个需求有没有什么问题"

## 2. query（需求查询）
用户想要查询某个已知需求的状态、进度、详情。
关键特征：
- 包含需求编号（如 REQ-20240315-001）
- 使用"查询"、"状态"、"进度"、"情况"等查询类动词
- 关注的是已有需求的信息，而非对新需求进行分析
- 示例：
  - "查询 REQ-20240315-001 的当前状态"
  - "REQ-20240415-002 的进度如何"
  - "查询 REQ-20240315-001 的风险分析报告"

## 3. chat（闲聊）
用户的输入与需求分析无关，属于日常对话或问候。
关键特征：
- 问候语、寒暄（"你好"、"早上好"）
- 闲聊话题（天气、心情等）
- 感谢或告别（"谢谢"、"再见"）
- 不包含任何需求描述或需求编号
- 示例：
  - "你好，今天天气不错"
  - "谢谢你的帮助"
  - "早上好"

## 优先级规则（重要）
1. **REQ-ID + 查询动词 → query**：如果输入包含需求编号且用户在询问已有信息（"查询"、"状态"、"进度"、"情况"、"如何"、"怎么样"、"报告"），判定为 query。例："查询 REQ-xxx 的风险分析报告" → query，"REQ-xxx 的进度如何" → query
2. **REQ-ID + 需求描述 → analyze**：即使包含需求编号，如果用户同时给出了大量功能描述、约束条件、业务场景等新需求内容，说明用户要的是分析，判定为 analyze。例："分析需求 REQ-xxx：开发在线问卷系统，支持多种题型..." → analyze
3. **明确分析请求 → analyze**：以"分析"、"评审"、"评估"、"拆解"开头，或详细描述了待开发功能的，判定为 analyze
4. **纯闲聊 → chat**：不包含任何需求相关内容（编号、功能描述、约束等）的日常对话，判定为 chat
5. **默认 analyze**：无法明确判断时，优先判定为 analyze（宁可多做分析，不要错误跳过）

请根据以上规则判断意图，并给出简要推理依据。`;

// ---------------------------------------------------------------
// Keyword-based fallback classifier
//
// 设计原则：关键词降级只做"极其确定"的判断，宁可默认为 analyze
// 也不要用脆弱的规则做精细分类。LLM 覆盖 99% 场景，这里只兜底。
// ---------------------------------------------------------------

/** 需求编号正则 */
const REQ_ID_RE = /REQ-\d{8}-\d{3,}/i;

function classifyByKeywords(input: string): ClassifiedIntent {
  const trimmed = input.trim();

  // 简短问候 / 感谢 / 告别 → 明确闲聊
  if (
    /^(你好|早上好|下午好|晚上好|嗨\b|谢谢|感谢|再见|拜拜|晚安|hello|hi\b)/i.test(
      trimmed,
    ) &&
    !REQ_ID_RE.test(trimmed)
  ) {
    return { intent: 'chat', reasoning: '关键词兜底：问候/感谢/告别语' };
  }

  // REQ-ID + 明确查询意图词 → query
  // 注意：这里只用高度特异性的查询词，避免泛化词（如"报告""如何""怎么样"）
  if (REQ_ID_RE.test(trimmed)) {
    const queryIndicators = /查询|查看|状态|进度|情况|进展|详情/;
    if (queryIndicators.test(trimmed)) {
      return {
        intent: 'query',
        reasoning: '关键词兜底：需求编号 + 查询指示词',
      };
    }
  }

  // 安全默认：analyze
  // 原因：如果 LLM 已经挂了，宁可多做一次分析，不要错误地把需求当闲聊忽略
  return { intent: 'analyze', reasoning: '关键词兜底：默认降级为需求分析' };
}

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
const RequirementAnalysisState = Annotation.Root({
  ...MessagesAnnotation.spec,
  input: Annotation<string>,
  retrievedContext: Annotation<string>,
  // 意图分类
  intent: Annotation<'analyze' | 'query' | 'chat'>({
    reducer: (_prev, next) => next,
    default: () => 'analyze',
  }),
  // 业务字段
  extracted: Annotation<Record<string, unknown>>,
  clarified: Annotation<{
    needsClarification: boolean;
    questions: string[];
    reason?: string;
    _error?: string;
  }>,
  analysisResult: Annotation<Record<string, unknown>>,
  riskResult: Annotation<Record<string, unknown>>,
  summary: Annotation<string>,
  // query / chat 独立响应
  queryResponse: Annotation<string>,
  chatResponse: Annotation<string>,
});

type State = typeof RequirementAnalysisState.State;

// ---------------------------------------------------------------
// Model instance（classifier + handler 节点复用）
// ---------------------------------------------------------------
const model = createChatModel();

// ---------------------------------------------------------------
// Node: classifier — 意图分类
// ---------------------------------------------------------------
async function classifierNode(state: State): Promise<Partial<State>> {
  try {
    const classifier = model.withStructuredOutput(IntentSchema);
    const result = await classifier.invoke([
      new SystemMessage(CLASSIFIER_SYSTEM_PROMPT),
      new HumanMessage(state.input),
    ]);

    return { intent: result.intent };
  } catch {
    // 降级：关键词匹配
    const fallback = classifyByKeywords(state.input);
    return { intent: fallback.intent };
  }
}

// ---------------------------------------------------------------
// Node: extract — 结构化需求抽取
// ---------------------------------------------------------------
async function extractNode(state: State): Promise<Partial<State>> {
  try {
    const raw = await extractAgent.invoke({ input: state.input });
    return { extracted: parseJson(raw, EXTRACT_FALLBACK) };
  } catch (err) {
    return {
      extracted: {
        ...EXTRACT_FALLBACK,
        _error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ---------------------------------------------------------------
// Node: clarify — 澄清判断
// ---------------------------------------------------------------
async function clarifyNode(state: State): Promise<Partial<State>> {
  try {
    const raw = await clarifyAgent.invoke({
      input: state.input,
      extracted: JSON.stringify(state.extracted, null, 2),
    });
    return { clarified: parseJson(raw, CLARIFY_FALLBACK) };
  } catch (err) {
    return {
      clarified: {
        ...CLARIFY_FALLBACK,
        _error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ---------------------------------------------------------------
// Node: analysis — 多维度需求分析
// ---------------------------------------------------------------
async function analysisNode(state: State): Promise<Partial<State>> {
  try {
    const raw = await analysisAgent.invoke({
      input: state.input,
      extracted: JSON.stringify(state.extracted),
      clarification: JSON.stringify(state.clarified),
    });
    return { analysisResult: parseJson(raw, ANALYSIS_FALLBACK) };
  } catch (err) {
    return {
      analysisResult: {
        ...ANALYSIS_FALLBACK,
        _error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ---------------------------------------------------------------
// Node: risk — 风险识别
// ---------------------------------------------------------------
async function riskNode(state: State): Promise<Partial<State>> {
  try {
    const raw = await riskAgent.invoke({
      input: state.input,
      extracted: JSON.stringify(state.extracted),
    });
    return { riskResult: parseJson(raw, RISK_FALLBACK) };
  } catch (err) {
    return {
      riskResult: {
        ...RISK_FALLBACK,
        _error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ---------------------------------------------------------------
// Node: summary — 汇总报告
// ---------------------------------------------------------------
async function summaryNode(state: State): Promise<Partial<State>> {
  try {
    const raw = await summaryAgent.invoke({
      input: state.input,
      extracted: JSON.stringify(state.extracted, null, 2),
      clarification: JSON.stringify(state.clarified, null, 2),
      analysis: JSON.stringify(state.analysisResult, null, 2),
      risk: JSON.stringify(state.riskResult, null, 2),
    });
    return { summary: raw };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      summary: `# 需求分析报告\n\n## ⚠️ 汇总阶段执行失败\n\n错误信息：${errorMsg}\n\n请检查上游节点输出或 LLM 服务状态。`,
    };
  }
}

// ---------------------------------------------------------------
// Node: queryHandler — 需求查询
// ---------------------------------------------------------------
async function queryHandlerNode(state: State): Promise<Partial<State>> {
  try {
    const response = await model.invoke([
      new SystemMessage(
        '你是需求查询助手。根据用户提供的需求编号，查询并返回该需求的状态、进度、分析结果等相关信息。如果无法查询到具体信息，请友好地告知用户当前可用的信息。',
      ),
      new HumanMessage(state.input),
    ]);
    const content =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    return { queryResponse: content, summary: content };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      queryResponse: `查询失败：${errorMsg}`,
      summary: `查询失败：${errorMsg}`,
    };
  }
}

// ---------------------------------------------------------------
// Node: chatHandler — 闲聊
// ---------------------------------------------------------------
async function chatHandlerNode(state: State): Promise<Partial<State>> {
  try {
    const response = await model.invoke([
      new SystemMessage(
        '你是友好的 AI 助手。请用热情、自然的方式与用户交流。回答应简洁得体，如果用户只是打招呼，也简单回应即可。',
      ),
      new HumanMessage(state.input),
    ]);
    const content =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    return { chatResponse: content, summary: content };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      chatResponse: `回复失败：${errorMsg}`,
      summary: `回复失败：${errorMsg}`,
    };
  }
}

// ---------------------------------------------------------------
// Conditional routing
// ---------------------------------------------------------------

/**
 * 根据意图返回下一个节点名称
 * - analyze → extractStep（走完整分析链）
 * - query  → queryHandler
 * - chat   → chatHandler
 */
function routeByIntent(
  state: State,
): 'extractStep' | 'queryHandler' | 'chatHandler' {
  if (state.intent === 'query') return 'queryHandler';
  if (state.intent === 'chat') return 'chatHandler';
  return 'extractStep';
}

// ---------------------------------------------------------------
// Graph factory
// ---------------------------------------------------------------

/**
 * 创建编译后的需求分析图
 *
 * 图结构：
 *   START → classifier
 *            ├─ analyze → extract → clarify → analysis → risk → summary → END
 *            ├─ query   → queryHandler → END
 *            └─ chat    → chatHandler  → END
 */
export function createAnalysisGraph() {
  return (
    new StateGraph(RequirementAnalysisState)
      // 意图分类
      .addNode('classifier', classifierNode)
      // 完整分析链
      .addNode('extractStep', extractNode)
      .addNode('clarifyStep', clarifyNode)
      .addNode('analysisStep', analysisNode)
      .addNode('riskStep', riskNode)
      .addNode('summaryStep', summaryNode)
      // query / chat 快捷路径
      .addNode('queryHandler', queryHandlerNode)
      .addNode('chatHandler', chatHandlerNode)
      // 边
      .addEdge(START, 'classifier')
      .addConditionalEdges('classifier', routeByIntent)
      .addEdge('extractStep', 'clarifyStep')
      .addEdge('clarifyStep', 'analysisStep')
      .addEdge('analysisStep', 'riskStep')
      .addEdge('riskStep', 'summaryStep')
      .addEdge('summaryStep', END)
      .addEdge('queryHandler', END)
      .addEdge('chatHandler', END)
      .compile()
  );
}

// ---------------------------------------------------------------
// Run helper — adapter 层
// ---------------------------------------------------------------

export interface GraphOrchestrationStep {
  agent: string;
  status: 'ok' | 'error';
  output: unknown;
  error?: string;
}

export interface GraphOrchestrationResult {
  mode: 'fixed';
  status: 'clarification_needed' | 'completed' | 'failed';
  clarificationQuestions?: string[];
  usedAgents: string[];
  fallback?: 'manual_review';
  steps: GraphOrchestrationStep[];
  report?: string;
  // 意图分类扩展
  intent?: 'analyze' | 'query' | 'chat';
  queryResponse?: string;
  chatResponse?: string;
}

/**
 * 运行需求分析图
 */
export async function runAnalysisGraph(
  input: string,
  retrievedContext?: string,
): Promise<GraphOrchestrationResult> {
  const normalizedInput = input.trim();
  const context = retrievedContext?.trim() ?? '';

  if (!normalizedInput) {
    return {
      mode: 'fixed',
      status: 'failed',
      usedAgents: [],
      fallback: 'manual_review',
      steps: [
        {
          agent: 'orchestrator',
          status: 'error',
          output: null,
          error: 'input 不能为空',
        },
      ],
    };
  }

  try {
    const graph = createAnalysisGraph();
    const state = await graph.invoke({
      input: normalizedInput,
      retrievedContext: context,
      messages: [],
    });

    const intent = state.intent ?? 'analyze';

    // query / chat 快捷路径 → 仅记录对应 handler
    if (intent === 'query') {
      return {
        mode: 'fixed',
        status: 'completed',
        intent: 'query',
        usedAgents: ['classifier', 'queryHandler'],
        queryResponse: state.queryResponse,
        steps: [
          { agent: 'classifier', status: 'ok', output: { intent } },
          {
            agent: 'queryHandler',
            status: 'ok',
            output: state.queryResponse,
          },
        ],
        report: state.summary,
      };
    }

    if (intent === 'chat') {
      return {
        mode: 'fixed',
        status: 'completed',
        intent: 'chat',
        usedAgents: ['classifier', 'chatHandler'],
        chatResponse: state.chatResponse,
        steps: [
          { agent: 'classifier', status: 'ok', output: { intent } },
          {
            agent: 'chatHandler',
            status: 'ok',
            output: state.chatResponse,
          },
        ],
        report: state.summary,
      };
    }

    // analyze 路径 — 完整分析链
    const usedAgents = [
      'classifier',
      'extractStep',
      'clarifyStep',
      'analysisStep',
      'riskStep',
      'summaryStep',
    ];

    const steps: GraphOrchestrationStep[] = [
      { agent: 'classifier', status: 'ok', output: { intent } },
      { agent: 'extractStep', status: 'ok', output: state.extracted },
      { agent: 'clarifyStep', status: 'ok', output: state.clarified },
      { agent: 'analysisStep', status: 'ok', output: state.analysisResult },
      { agent: 'riskStep', status: 'ok', output: state.riskResult },
      { agent: 'summaryStep', status: 'ok', output: state.summary },
    ];

    if (
      state.clarified?.needsClarification &&
      state.clarified?.questions?.length > 0
    ) {
      return {
        mode: 'fixed',
        status: 'clarification_needed',
        intent: 'analyze',
        clarificationQuestions: state.clarified.questions,
        usedAgents,
        steps: steps.slice(0, 3), // classifier + extract + clarify
      };
    }

    return {
      mode: 'fixed',
      status: 'completed',
      intent: 'analyze',
      usedAgents,
      steps,
      report: state.summary,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      mode: 'fixed',
      status: 'failed',
      usedAgents: [],
      fallback: 'manual_review',
      steps: [
        {
          agent: 'orchestrator',
          status: 'error',
          output: null,
          error: message,
        },
      ],
    };
  }
}
