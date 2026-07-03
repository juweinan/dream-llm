import {
  StateGraph,
  Annotation,
  START,
  END,
  MessagesAnnotation,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { createChatModel } from '../model.factory';
import { extractAgent, clarifyAgent, riskAgent } from '../agents/sub-agents';
import {
  createAnalysisSupervisorSubGraph,
  type SupervisorState,
} from './experts';

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
// ---------------------------------------------------------------

/** 需求编号正则 */
const REQ_ID_RE = /REQ-\d{8}-\d{3,}/i;

function classifyByKeywords(input: string): ClassifiedIntent {
  const trimmed = input.trim();

  if (
    /^(你好|早上好|下午好|晚上好|嗨\b|谢谢|感谢|再见|拜拜|晚安|hello|hi\b)/i.test(
      trimmed,
    ) &&
    !REQ_ID_RE.test(trimmed)
  ) {
    return { intent: 'chat', reasoning: '关键词兜底：问候/感谢/告别语' };
  }

  if (REQ_ID_RE.test(trimmed)) {
    const queryIndicators = /查询|查看|状态|进度|情况|进展|详情/;
    if (queryIndicators.test(trimmed)) {
      return {
        intent: 'query',
        reasoning: '关键词兜底：需求编号 + 查询指示词',
      };
    }
  }

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
  // ReAct 子图工具轮次计数
  toolLoopCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  // Critic-Refine 子图：评审意见（空字符串 = 通过）
  critique: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  // Critic-Refine 子图：修订次数（硬上限 2）
  reviseCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  // ===============================================================
  // 第 9 章 Supervisor + 多专家架构 新增字段
  // ===============================================================
  // Supervisor 决策：当前激活的专家列表
  activeExperts: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  // Supervisor 决策理由（调试 & 审计用）
  supervisorReasoning: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  // 各专家独立输出
  functionalAnalysis: Annotation<Record<string, unknown>>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),
  performanceAnalysis: Annotation<Record<string, unknown>>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),
  securityAnalysis: Annotation<Record<string, unknown>>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),
  complianceAnalysis: Annotation<Record<string, unknown>>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),
});

type State = typeof RequirementAnalysisState.State;

// ---------------------------------------------------------------
// Model instance
// ---------------------------------------------------------------
const model = createChatModel();

// ---------------------------------------------------------------
// Mock tools for ReAct analysis subgraph
// ---------------------------------------------------------------

/**
 * search_requirement — 根据需求编号查询需求详情（Mock）
 *
 * 生产环境中应替换为真实数据库查询或 API 调用。
 */
const searchRequirement = tool(
  async ({ reqId }: { reqId: string }) => {
    // Mock 实现：返回一个模拟的需求详情
    const mockData: Record<string, Record<string, unknown>> = {
      'REQ-20240315-001': {
        id: 'REQ-20240315-001',
        title: '在线问卷系统',
        status: 'in_progress',
        priority: 'high',
        description:
          '开发在线问卷系统，支持单选、多选、填空题型，支持问卷发布与数据统计',
        owner: '产品团队',
        created: '2024-03-15',
        deadline: '2024-06-15',
        modules: ['题目管理', '问卷发布', '数据统计', '用户作答'],
      },
      'REQ-20240415-002': {
        id: 'REQ-20240415-002',
        title: '用户认证模块',
        status: 'pending',
        priority: 'critical',
        description: '实现统一用户认证，支持 SSO、OAuth2.0、JWT 令牌管理',
        owner: '安全团队',
        created: '2024-04-15',
        modules: ['SSO 集成', 'OAuth 认证', 'JWT 管理', '权限校验'],
      },
    };

    if (reqId in mockData) {
      return JSON.stringify(mockData[reqId], null, 2);
    }
    return JSON.stringify({
      error: `未找到需求 ${reqId}`,
      suggestion: '请检查需求编号是否正确',
    });
  },
  {
    name: 'search_requirement',
    description:
      '根据需求编号（REQ-XXXXXXXX-XXX）查询已登记需求的详细信息，包括标题、状态、优先级、描述、模块划分等',
    schema: z.object({
      reqId: z.string().describe('需求编号，格式如 REQ-20240315-001'),
    }),
  },
);

/**
 * check_conflicts — 检测需求与现有系统的冲突（Mock）
 *
 * 生产环境中应替换为真实冲突检测逻辑。
 */
const checkConflicts = tool(
  async ({ reqId, description }: { reqId: string; description: string }) => {
    // Mock 实现：基于关键词检测潜在冲突
    const conflicts: { type: string; detail: string }[] = [];
    const desc = description.toLowerCase();

    if (/登录|认证|auth|login|sso|权限|角色/.test(desc)) {
      conflicts.push({
        type: '模块冲突',
        detail: `与已有认证模块可能存在功能重叠，建议检查现有 ${reqId} 的职责边界`,
      });
    }
    if (/支付|交易|订单/.test(desc)) {
      conflicts.push({
        type: '数据冲突',
        detail: `与支付系统的数据模型可能存在不一致，建议与支付团队对齐 Schema`,
      });
    }
    if (/通知|消息|推送|邮件/.test(desc)) {
      conflicts.push({
        type: '服务冲突',
        detail: '与现有通知中心服务功能重叠，建议复用已有的消息通道',
      });
    }

    if (conflicts.length === 0) {
      return JSON.stringify({
        hasConflicts: false,
        message: `未检测到 ${reqId} 与现有系统的明显冲突`,
      });
    }

    return JSON.stringify({
      hasConflicts: true,
      conflicts,
      suggestion: `检测到 ${conflicts.length} 项潜在冲突，建议组织跨团队评审`,
    });
  },
  {
    name: 'check_conflicts',
    description:
      '检测新需求或功能变更与现有系统之间是否存在潜在冲突，包括模块重叠、数据不一致、服务重复等',
    schema: z.object({
      reqId: z.string().describe('需求编号，如无可用 "unknown" 代替'),
      description: z.string().describe('需求或功能的简要描述'),
    }),
  },
);

/** ReAct 子图使用的工具集合 */
const analysisTools = [searchRequirement, checkConflicts];

// ---------------------------------------------------------------
// ReAct analysis subgraph
// ---------------------------------------------------------------

/** 子图状态：继承 MessagesAnnotation + 子图需要的业务字段 */
const AnalysisSubgraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  input: Annotation<string>,
  extracted: Annotation<Record<string, unknown>>,
  clarified: Annotation<Record<string, unknown>>,
  toolLoopCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  analysisResult: Annotation<Record<string, unknown>>,
});

type SubgraphState = typeof AnalysisSubgraphState.State;

/** ReAct 最大工具轮次 */
const MAX_TOOL_ROUNDS = 6;

const ANALYSIS_AGENT_SYSTEM_PROMPT = `你是一名资深需求分析师。对需求进行多维度深度分析。

## 工具使用规则
1. 如果输入中包含需求编号（如 REQ-XXX），先调用 search_requirement 查询需求详情
2. 如果需要检测该需求与现有系统的冲突（涉及用户认证、支付、通知等），调用 check_conflicts
3. 工具调用 1-3 次即可，获取足够信息后必须停止

## 关键规则：获取工具结果后立即输出 JSON
- 当你收到工具的返回数据后，**不要再调用更多工具**，直接基于已有信息输出分析 JSON
- 即使没有调用任何工具，也要基于你的专业知识直接输出分析结论
- 工具只是辅助，最终分析必须由你完成并输出 JSON

## 输出要求（纯 JSON，不要 markdown 包裹）
{
  "functionalDecomposition": [{ "name": "...", "description": "...", "complexity": "low/medium/high" }],
  "userStories": ["As a ..., I want ..., so that ..."],
  "acceptanceCriteria": [{ "module": "...", "criterion": "..." }],
  "dependencies": [{ "target": "...", "type": "external/internal", "impact": "blocking/optional" }],
  "technicalComplexity": "low/medium/high",
  "suggestions": ["建议1", "建议2"]
}

现在请直接开始分析。如果不需要工具，直接输出 JSON；如果需要查信息，调用相关工具后立即输出 JSON。`;

/** 子图 agentNode：绑定工具的 LLM 节点 */
async function subgraphAgentNode(
  state: SubgraphState,
): Promise<Partial<SubgraphState>> {
  const agentModel = createChatModel().bindTools(analysisTools);

  // 首轮：构造 system prompt + 上下文 HumanMessage
  if (state.messages.length === 0) {
    const contextParts: string[] = [`## 原始需求\n${state.input}`];

    if (state.extracted && Object.keys(state.extracted).length > 0) {
      contextParts.push(
        `## 已抽取字段\n${JSON.stringify(state.extracted, null, 2)}`,
      );
    }

    if (state.clarified && Object.keys(state.clarified).length > 0) {
      contextParts.push(
        `## 澄清结果\n${JSON.stringify(state.clarified, null, 2)}`,
      );
    }

    const humanContent = contextParts.join('\n\n');

    const response = await agentModel.invoke([
      new SystemMessage(ANALYSIS_AGENT_SYSTEM_PROMPT),
      new HumanMessage(humanContent),
    ]);

    return { messages: [response] };
  }

  // 后续轮次：传入完整消息历史（含 tool_calls + tool 结果），
  // 并在开头注入 system prompt，让模型知道继续遵守规则
  const response = await agentModel.invoke([
    new SystemMessage(ANALYSIS_AGENT_SYSTEM_PROMPT),
    ...state.messages,
  ]);

  return { messages: [response] };
}

/** 子图 finalizeNode：从消息历史中提取分析结果 */
async function subgraphFinalizeNode(
  state: SubgraphState,
): Promise<Partial<SubgraphState>> {
  try {
    // 从后往前找第一条 content 非空且不含 tool_calls 的 AIMessage
    const lastAnalysis = state.messages
      .slice()
      .reverse()
      .find((m) => {
        if (m.getType() !== 'ai') return false;
        const ai = m as AIMessage;
        if (ai.tool_calls && ai.tool_calls.length > 0) return false;
        const content = typeof ai.content === 'string' ? ai.content : '';
        return content.trim().length > 0;
      });

    if (!lastAnalysis) {
      return {
        analysisResult: {
          ...ANALYSIS_FALLBACK,
          _error:
            'ReAct 子图未找到有效的 AI 分析回复（所有 AI 消息均含 tool_calls）',
        },
      };
    }

    const content =
      typeof lastAnalysis.content === 'string'
        ? lastAnalysis.content
        : JSON.stringify(lastAnalysis.content);

    return { analysisResult: parseJson(content, ANALYSIS_FALLBACK) };
  } catch (err) {
    return {
      analysisResult: {
        ...ANALYSIS_FALLBACK,
        _error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/** 包装 ToolNode：每次调用工具时递增 toolLoopCount，防止死循环 */
async function toolsWithCounterNode(
  state: SubgraphState,
): Promise<Partial<SubgraphState>> {
  const toolNode = new ToolNode(analysisTools);
  const result = (await toolNode.invoke(state)) as SubgraphState;
  const resultMessages = result.messages;
  return {
    messages: resultMessages,
    toolLoopCount: (state.toolLoopCount ?? 0) + 1,
  };
}

/**
 * 子图条件路由：决定继续调用工具还是结束分析
 *
 * - 有 tool_calls 且轮次未达上限 → tools
 * - 否则 → finalize
 */
function shouldContinueTools(state: SubgraphState): 'tools' | 'finalize' {
  const lastMsg = state.messages[state.messages.length - 1];

  if (
    lastMsg instanceof AIMessage &&
    lastMsg.tool_calls &&
    lastMsg.tool_calls.length > 0 &&
    state.toolLoopCount < MAX_TOOL_ROUNDS
  ) {
    return 'tools';
  }

  return 'finalize';
}

/**
 * 创建 ReAct 分析子图
 *
 * 图结构：
 *   START → agent
 *            ├─(有 tool_calls + 未达上限) → tools(+counter) → agent
 *            └─(无 tool_calls 或达到上限) → finalize → END
 *
 * 子图可通过 graph.invoke() 独立运行，也可作为主图的嵌套节点。
 */
export function createAnalysisSubGraph() {
  return new StateGraph(AnalysisSubgraphState)
    .addNode('agent', subgraphAgentNode)
    .addNode('tools', toolsWithCounterNode)
    .addNode('finalize', subgraphFinalizeNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinueTools)
    .addEdge('tools', 'agent')
    .addEdge('finalize', END)
    .compile();
}

// ---------------------------------------------------------------
// Main graph nodes
// ---------------------------------------------------------------

/** Node: classifier — 意图分类 */
async function classifierNode(state: State): Promise<Partial<State>> {
  try {
    const classifier = model.withStructuredOutput(IntentSchema);
    const result = await classifier.invoke([
      new SystemMessage(CLASSIFIER_SYSTEM_PROMPT),
      new HumanMessage(state.input),
    ]);

    return { intent: result.intent };
  } catch {
    const fallback = classifyByKeywords(state.input);
    return { intent: fallback.intent };
  }
}

/** Node: extract — 结构化需求抽取 */
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

/** Node: clarify — 澄清判断 */
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

/**
 * Node: analysisSubgraph — 调用 ReAct 子图进行多维度需求分析（第 8 章实现）
 *
 * 替代原来的 analysisNode，将主图 state 映射到子图 state，
 * 子图内 agent → tools → agent → ... → finalize 循环执行，
 * 最后将子图的 analysisResult 写回主图 State。
 *
 * ⚠️ 保留用于对比测试，第 9 章默认使用 analysisSupervisorNode。
 *     如需回退到单 Agent 模式，在 createAnalysisGraph 中将
 *     'analysisSupervisor' 替换为 'analysisSubgraph'。
 */
async function analysisSubgraphNode(state: State): Promise<Partial<State>> {
  try {
    const subgraph = createAnalysisSubGraph();
    const subResult = await subgraph.invoke({
      input: state.input,
      extracted: state.extracted,
      clarified: state.clarified,
      toolLoopCount: 0,
      messages: [],
    });

    return {
      analysisResult: subResult.analysisResult ?? ANALYSIS_FALLBACK,
      toolLoopCount: subResult.toolLoopCount ?? 0,
    };
  } catch (err) {
    return {
      analysisResult: {
        ...ANALYSIS_FALLBACK,
        _error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Node: analysisSupervisor — 调用 Supervisor + 多专家子图（第 9 章实现）
 *
 * 替代 analysisSubgraphNode，将主图 state 映射到 Supervisor 子图 state，
 * 子图内 supervisor → [并行专家] → aggregator 执行，
 * 最后将子图的 analysisResult 及专家中间输出写回主图 State。
 *
 * 与 analysisSubgraphNode 的对比：
 *   - 第 8 章：单 Agent ReAct 循环（agent ⇄ tools → finalize）
 *   - 第 9 章：Supervisor 决策 → 多专家并行分析 → Aggregator 合并
 */
async function analysisSupervisorNode(state: State): Promise<Partial<State>> {
  try {
    const subgraph = createAnalysisSupervisorSubGraph({
      model,
      // 为各专家配置工具集：
      // - functional 专家使用需求查询、实体查询、约束校验工具
      // - security 专家使用冲突检测工具
      // - performance / compliance 专家使用文件读取工具查阅规范
      expertTools: {
        functional: analysisTools,
        performance: [], // 可扩展：readFileTool 等
        security: [checkConflicts],
        compliance: [], // 可扩展：readFileTool 等
      },
    });

    const subResult = await subgraph.invoke({
      input: state.input,
      extracted: state.extracted ?? {},
      clarified: state.clarified ?? {},
      activeExperts: [],
      functionalAnalysis: {},
      performanceAnalysis: {},
      securityAnalysis: {},
      complianceAnalysis: {},
      analysisResult: {},
      toolLoopCount: 0,
    });

    // 将子图的专家输出和最终结果写回主图 State
    return {
      analysisResult: subResult.analysisResult ?? ANALYSIS_FALLBACK,
      activeExperts: subResult.activeExperts ?? [],
      supervisorReasoning: subResult.supervisorReasoning ?? '',
      functionalAnalysis: subResult.functionalAnalysis ?? {},
      performanceAnalysis: subResult.performanceAnalysis ?? {},
      securityAnalysis: subResult.securityAnalysis ?? {},
      complianceAnalysis: subResult.complianceAnalysis ?? {},
      toolLoopCount: subResult.toolLoopCount ?? 0,
    };
  } catch (err) {
    return {
      analysisResult: {
        ...ANALYSIS_FALLBACK,
        _error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/** Node: risk — 风险识别 */
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
// Critic-Refine summary subgraph
// ---------------------------------------------------------------

const ACTOR_SYSTEM_PROMPT = `你是资深需求分析师。根据分析和风险评估生成综合报告。

**报告必需章节**：
1. 需求摘要：200-300 字概述
2. 功能分解：主要模块和子功能
3. 冲突分析：与现有需求的冲突点 + 解决方案
4. 技术复杂度：评估（低/中/高）+ 理由
5. 开发排期：各阶段时长 + 依赖项

**格式要求**：
- 使用 Markdown 标题（## 和 ###）
- 关键信息用粗体或列表
- 排期必须标明依赖关系
- 冲突分析必须包含解决方案，不能只描述问题`;

const CRITIC_SYSTEM_PROMPT = `你是资深需求评审专家。按以下标准检查综合报告：

**评审标准**（必须全部满足）：
1. 章节完整性：必须包含"需求摘要"、"冲突分析"、"技术复杂度"、"开发排期"
2. 排期依赖项：排期章节必须标明各阶段的依赖关系（如"前端开发依赖后端 API 完成"）
3. 冲突解决方案：如果存在冲突，必须给出具体解决方案，不能只描述问题
4. 逻辑一致性：各章节之间不能有明显矛盾（如摘要说低复杂度，但技术分析提到大规模重构）

**输出要求**：
- 如果全部满足，返回 pass=true, critique=""
- 如果任一不满足，返回 pass=false，并给出最关键的 1-2 条修改意见
- 修改意见要具体，指出缺少什么或哪里矛盾
- 避免主观性评价（如"语言不够优美"）

**重要**：不要过度严格，只检查核心要素，否则会导致无限循环。`;

const REFINE_SYSTEM_PROMPT = `你是需求分析师。根据评审意见修订报告。

**修订原则**：
1. 只修改被指出的问题部分
2. 未被批评的章节保持不变
3. 补充缺失的章节或内容
4. 修正逻辑矛盾

**禁止行为**：
- 不要重新生成整个报告
- 不要删除正确的内容
- 不要改变原有的结构和风格`;

/** Critic 结构化输出 schema */
const CriticOutputSchema = z.object({
  pass: z.boolean().describe('是否通过评审'),
  critique: z.string().describe('不通过时的修改意见，通过时为空'),
  issues: z.array(z.string()).optional().describe('具体问题列表'),
});

/** actorNode — 生成初版报告 */
async function actorNode(state: State): Promise<Partial<State>> {
  try {
    const response = await model.invoke([
      new SystemMessage(ACTOR_SYSTEM_PROMPT),
      new HumanMessage(
        `原始需求：${state.input}\n\n提取结果：${JSON.stringify(state.extracted)}\n\n分析结果：${JSON.stringify(state.analysisResult)}\n\n风险评估：${JSON.stringify(state.riskResult)}\n\n请生成完整的综合报告。`,
      ),
    ]);

    return {
      summary:
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      summary: `# 需求分析报告\n\n## ⚠️ 报告生成失败\n\n错误信息：${errorMsg}\n\n请检查上游节点输出或 LLM 服务状态。`,
    };
  }
}

/** criticNode — 评审检查 */
async function criticNode(state: State): Promise<Partial<State>> {
  try {
    const critic = model.withStructuredOutput(CriticOutputSchema);
    const result = await critic.invoke([
      new SystemMessage(CRITIC_SYSTEM_PROMPT),
      new HumanMessage(`待评审报告：\n\n${state.summary}\n\n请按标准评审。`),
    ]);

    console.log(
      `[Critic] pass=${result.pass}, issues=${result.issues?.length ?? 0}`,
    );

    return { critique: result.pass ? '' : result.critique };
  } catch (err) {
    // 评审异常时，critique 写入错误信息而非空字符串。
    // 这样做有两个效果：
    //   1. 不会假装"通过评审"——refine 节点会尝试修复
    //   2. 但如果 refine 也无法修复，至少 critique 里有错误痕迹
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Critic] 评审异常，降级:', errorMsg);
    return {
      critique: `⚠️ 评审检查执行失败：${errorMsg}。请人工检查报告质量。`,
    };
  }
}

/** refineNode — 修订改进 */
async function refineNode(state: State): Promise<Partial<State>> {
  try {
    const response = await model.invoke([
      new SystemMessage(REFINE_SYSTEM_PROMPT),
      new HumanMessage(
        `原报告：\n\n${state.summary}\n\n评审意见：\n\n${state.critique}\n\n请根据评审意见修订报告，只改有问题的地方。`,
      ),
    ]);

    console.log(`[Refine] reviseCount=${state.reviseCount + 1}`);

    return {
      summary:
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content),
      reviseCount: (state.reviseCount ?? 0) + 1,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Refine] 修订失败:', errorMsg);
    // 修订失败时保持原报告不变，仅递增计数防止死循环
    return { reviseCount: (state.reviseCount ?? 0) + 1 };
  }
}

/** shouldRefine — 条件边：决定是修订还是结束 */
function shouldRefine(state: State): '__end__' | 'refine' {
  if ((state.reviseCount ?? 0) >= 2) {
    console.log('[Critic子图] 达到修订上限，强制终止');
    return '__end__';
  }

  if (!state.critique || state.critique.trim() === '') {
    console.log('[Critic子图] 通过评审，完成');
    return '__end__';
  }

  console.log('[Critic子图] 未通过评审，进入 refine');
  return 'refine';
}

/**
 * 创建 Critic-Refine 汇总子图
 *
 * 图结构：
 *   START → actor → critic ─(通过)→ END
 *                       └(不通过)→ refine → critic（回边，最多 2 次）
 */
export function createSummarySubGraph() {
  return new StateGraph(RequirementAnalysisState)
    .addNode('actor', actorNode)
    .addNode('critic', criticNode)
    .addNode('refine', refineNode)
    .addEdge(START, 'actor')
    .addEdge('actor', 'critic')
    .addConditionalEdges('critic', shouldRefine, {
      __end__: END,
      refine: 'refine',
    } as any)
    .addEdge('refine', 'critic')
    .compile();
}

/** Node: summarySubgraph — 调用 Critic-Refine 子图取代原来的 summaryNode */
async function summarySubgraphNode(state: State): Promise<Partial<State>> {
  try {
    const subgraph = createSummarySubGraph();
    const subResult = await subgraph.invoke(state);

    return {
      summary: subResult.summary ?? '',
      critique: subResult.critique ?? '',
      reviseCount: subResult.reviseCount ?? 0,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      summary: `# 需求分析报告\n\n## ⚠️ 汇总阶段执行失败\n\n错误信息：${errorMsg}\n\n请检查上游节点输出或 LLM 服务状态。`,
    };
  }
}

/** Node: queryHandler — 需求查询 */
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

/** Node: chatHandler — 闲聊 */
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
 * 图结构（第 9 章）：
 *   START → classifier
 *            ├─ analyze → extract → clarify → analysisSupervisor(Supervisor+多专家) → risk → summary → END
 *            ├─ query   → queryHandler → END
 *            └─ chat    → chatHandler  → END
 *
 * 其中 analysisSupervisor 内部是 Supervisor + 多专家架构：
 *   supervisor → [functional | performance | security | compliance] → aggregator
 *
 * ═══════════════════════════════════════════════════════════════════
 * 如何切换回第 8 章单 Agent ReAct 模式：
 *   1. 将下方 'analysisSupervisor' 替换为 'analysisSubgraph'
 *   2. 将 analysisSupervisorNode 替换为 analysisSubgraphNode
 * ═══════════════════════════════════════════════════════════════════
 */
export function createAnalysisGraph() {
  return (
    new StateGraph(RequirementAnalysisState)
      .addNode('classifier', classifierNode)
      .addNode('extractStep', extractNode)
      .addNode('clarifyStep', clarifyNode)
      // 第 9 章：Supervisor + 多专家架构（默认）
      // 如需回退第 8 章单 Agent 模式，替换为：
      // .addNode('analysisSubgraph', analysisSubgraphNode as any)
      .addNode('analysisSupervisor', analysisSupervisorNode as any)
      .addNode('riskStep', riskNode)
      .addNode('summaryStep', summarySubgraphNode)
      .addNode('queryHandler', queryHandlerNode)
      .addNode('chatHandler', chatHandlerNode)
      .addEdge(START, 'classifier')
      .addConditionalEdges('classifier', routeByIntent)
      .addEdge('extractStep', 'clarifyStep')
      .addEdge('clarifyStep', 'analysisSupervisor')
      .addEdge('analysisSupervisor', 'riskStep')
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
  intent?: 'analyze' | 'query' | 'chat';
  queryResponse?: string;
  chatResponse?: string;
  toolLoopCount?: number;
  reviseCount?: number;
  // 第 9 章 Supervisor + 多专家架构新增字段
  activeExperts?: string[];
  supervisorReasoning?: string;
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

    const usedAgents = [
      'classifier',
      'extractStep',
      'clarifyStep',
      // 第 9 章：analysisSupervisor 替代 analysisSubgraph
      'analysisSupervisor',
      'riskStep',
      'summaryStep',
    ];

    const steps: GraphOrchestrationStep[] = [
      { agent: 'classifier', status: 'ok', output: { intent } },
      { agent: 'extractStep', status: 'ok', output: state.extracted },
      { agent: 'clarifyStep', status: 'ok', output: state.clarified },
      {
        // 第 9 章：输出中包含 Supervisor 决策信息
        agent: 'analysisSupervisor',
        status: 'ok',
        output: {
          analysisResult: state.analysisResult,
          activeExperts: state.activeExperts,
          supervisorReasoning: state.supervisorReasoning,
        },
      },
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
        toolLoopCount: state.toolLoopCount,
        reviseCount: state.reviseCount,
        steps: steps.slice(0, 3),
      };
    }

    return {
      mode: 'fixed',
      status: 'completed',
      intent: 'analyze',
      usedAgents,
      steps,
      report: state.summary,
      toolLoopCount: state.toolLoopCount,
      reviseCount: state.reviseCount,
      // 第 9 章：Supervisor 决策信息
      activeExperts: state.activeExperts,
      supervisorReasoning: state.supervisorReasoning,
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

// ---------------------------------------------------------------
// Streaming run helper — SSE 逐节点推送进度
// ---------------------------------------------------------------

export interface GraphStreamEvent {
  type: 'node_started' | 'node_completed' | 'done' | 'error';
  node?: string;
  output?: unknown;
  meta?: Record<string, unknown>;
  result?: GraphOrchestrationResult;
  error?: string;
}

/**
 * 流式运行需求分析图
 *
 * 使用 graph.stream() 逐节点推送进度，通过 async generator 返回 SSE 事件。
 * 与 runAnalysisGraph 共享同一个图结构，只是把 invoke 替换为 stream。
 */
export async function* runAnalysisGraphStream(
  input: string,
  retrievedContext?: string,
): AsyncGenerator<GraphStreamEvent> {
  const normalizedInput = input.trim();
  const context = retrievedContext?.trim() ?? '';

  // 输入为空 → 立即返回错误
  if (!normalizedInput) {
    yield {
      type: 'error',
      error: 'input 不能为空',
    };
    return;
  }

  const graph = createAnalysisGraph();

  // 跟踪已完成的节点，用于判断意图路径
  const completedNodes: string[] = [];
  // 累积 state（覆盖型字段取最后一次）
  let accumulatedState: Record<string, unknown> = {};

  try {
    const stream = await graph.stream(
      { input: normalizedInput, retrievedContext: context, messages: [] },
      // 不传 configurable，每次流式调用都是独立的（与 runAnalysisGraph 一致）
    );

    for await (const chunk of stream) {
      // chunk 结构：{ nodeName: Partial<State> }
      const entries = Object.entries(chunk);
      for (const [nodeName, nodeOutput] of entries) {
        completedNodes.push(nodeName);
        accumulatedState = {
          ...accumulatedState,
          ...(nodeOutput as Record<string, unknown>),
        };

        yield {
          type: 'node_completed',
          node: nodeName,
          output: nodeOutput,
          meta: {
            nodesCompleted: completedNodes.length,
            completedNodes: [...completedNodes],
          },
        };
      }
    }

    // 图正常结束 → 从累积 state 构造结果
    const intent = (accumulatedState.intent as string) ?? 'analyze';

    if (intent === 'query') {
      yield {
        type: 'done',
        result: {
          mode: 'fixed',
          status: 'completed',
          intent: 'query',
          usedAgents: ['classifier', 'queryHandler'],
          queryResponse: (accumulatedState.queryResponse as string) ?? '',
          steps: [
            { agent: 'classifier', status: 'ok', output: { intent } },
            {
              agent: 'queryHandler',
              status: 'ok',
              output: accumulatedState.queryResponse,
            },
          ],
          report: (accumulatedState.summary as string) ?? '',
        },
      };
      return;
    }

    if (intent === 'chat') {
      yield {
        type: 'done',
        result: {
          mode: 'fixed',
          status: 'completed',
          intent: 'chat',
          usedAgents: ['classifier', 'chatHandler'],
          chatResponse: (accumulatedState.chatResponse as string) ?? '',
          steps: [
            { agent: 'classifier', status: 'ok', output: { intent } },
            {
              agent: 'chatHandler',
              status: 'ok',
              output: accumulatedState.chatResponse,
            },
          ],
          report: (accumulatedState.summary as string) ?? '',
        },
      };
      return;
    }

    // analyze 路径
    const usedAgents = [
      'classifier',
      'extractStep',
      'clarifyStep',
      // 第 9 章：analysisSupervisor 替代 analysisSubgraph
      'analysisSupervisor',
      'riskStep',
      'summaryStep',
    ];

    const steps: GraphOrchestrationStep[] = [
      { agent: 'classifier', status: 'ok', output: { intent } },
      {
        agent: 'extractStep',
        status: 'ok',
        output: accumulatedState.extracted,
      },
      {
        agent: 'clarifyStep',
        status: 'ok',
        output: accumulatedState.clarified,
      },
      {
        // 第 9 章：输出中包含 Supervisor 决策信息
        agent: 'analysisSupervisor',
        status: 'ok',
        output: {
          analysisResult: accumulatedState.analysisResult,
          activeExperts: accumulatedState.activeExperts,
          supervisorReasoning: accumulatedState.supervisorReasoning,
        },
      },
      { agent: 'riskStep', status: 'ok', output: accumulatedState.riskResult },
      { agent: 'summaryStep', status: 'ok', output: accumulatedState.summary },
    ];

    const clarified = accumulatedState.clarified as
      | Record<string, unknown>
      | undefined;
    if (
      clarified?.needsClarification &&
      Array.isArray(clarified.questions) &&
      clarified.questions.length > 0
    ) {
      yield {
        type: 'done',
        result: {
          mode: 'fixed',
          status: 'clarification_needed',
          intent: 'analyze',
          clarificationQuestions: clarified.questions as string[],
          usedAgents,
          toolLoopCount: (accumulatedState.toolLoopCount as number) ?? 0,
          reviseCount: (accumulatedState.reviseCount as number) ?? 0,
          steps: steps.slice(0, 3),
        },
      };
      return;
    }

    yield {
      type: 'done',
      result: {
        mode: 'fixed',
        status: 'completed',
        intent: 'analyze',
        usedAgents,
        steps,
        report: (accumulatedState.summary as string) ?? '',
        toolLoopCount: (accumulatedState.toolLoopCount as number) ?? 0,
        reviseCount: (accumulatedState.reviseCount as number) ?? 0,
        // 第 9 章：Supervisor 决策信息
        activeExperts: (accumulatedState.activeExperts as string[]) ?? [],
        supervisorReasoning:
          (accumulatedState.supervisorReasoning as string) ?? '',
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield {
      type: 'error',
      error: message,
    };
  }
}
