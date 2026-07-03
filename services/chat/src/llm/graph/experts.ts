import {
  StateGraph,
  Annotation,
  START,
  END,
  MessagesAnnotation,
  Send,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';

// ---------------------------------------------------------------
// Model type helper
//
// BaseChatModel 将 bindTools 声明为可选方法 (bindTools?)，
// 但实际传入的模型实例（ChatAnthropic / ChatDeepSeek / ChatOpenAI）
// 在运行时一定支持工具调用。通过此辅助函数消除类型层面的 undefined。
// ---------------------------------------------------------------
function bindToolsChecked(
  model: BaseChatModel,
  tools: StructuredToolInterface[],
) {
  if (typeof (model as any).bindTools !== 'function') {
    throw new Error(
      `Model ${model.constructor.name} does not support tool calling (bindTools unavailable).`,
    );
  }

  return (model as any).bindTools(tools) as ReturnType<
    NonNullable<BaseChatModel['bindTools']>
  >;
}

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
// Expert output fallback
// ---------------------------------------------------------------
const EXPERT_FALLBACK: Record<string, unknown> = {
  _error: '专家分析未产出有效结果',
  suggestions: ['请人工复核该维度分析'],
};

// ---------------------------------------------------------------
// Expert subgraph state
// ---------------------------------------------------------------

/**
 * 专家子图 State
 *
 * 继承 MessagesAnnotation 以支持 ReAct 工具调用循环。
 * expertOutput 是专家的最终分析结论，由 finalize 节点填充。
 */
const ExpertSubgraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  input: Annotation<string>,
  extracted: Annotation<Record<string, unknown>>,
  clarified: Annotation<Record<string, unknown>>,
  toolLoopCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  expertOutput: Annotation<Record<string, unknown>>,
});

type ExpertState = typeof ExpertSubgraphState.State;

// ---------------------------------------------------------------
// createExpertSubGraph — 通用专家子图工厂
// ---------------------------------------------------------------

/**
 * 创建一个可独立运行的专家 ReAct 子图。
 *
 * 图结构：
 *   START → agent ⇄ tools → finalize → END
 *
 * 参数：
 * - model:         已创建的 LLM 实例（不在此函数内调用 createChatModel）
 * - tools:         该专家可用的工具集合
 * - systemPrompt:  专家的角色与行为描述
 * - outputField:   输出字段名（用于日志与错误提示）
 * - maxToolRounds: ReAct 最大工具轮次，默认 4
 */
export function createExpertSubGraph({
  model,
  tools,
  systemPrompt,
  outputField,
  maxToolRounds = 4,
  checkpointer,
}: {
  model: BaseChatModel;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  outputField: string;
  maxToolRounds?: number;
  checkpointer?: BaseCheckpointSaver | boolean;
}) {
  const agentModel = bindToolsChecked(model, tools);

  /** agentNode — 绑定工具的 LLM 推理节点 */
  async function agentNode(state: ExpertState): Promise<Partial<ExpertState>> {
    if (state.messages.length === 0) {
      // 首轮：构造上下文
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

      const response = await agentModel.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(contextParts.join('\n\n')),
      ]);

      return { messages: [response] };
    }

    // 后续轮次：注入 system prompt + 完整消息历史
    const response = await agentModel.invoke([
      new SystemMessage(systemPrompt),
      ...state.messages,
    ]);

    return { messages: [response] };
  }

  /** toolsNode — 带计数器的工具执行节点 */
  async function toolsNode(state: ExpertState): Promise<Partial<ExpertState>> {
    const toolNode = new ToolNode(tools);
    const result = (await toolNode.invoke(state)) as ExpertState;
    return {
      messages: result.messages,
      toolLoopCount: (state.toolLoopCount ?? 0) + 1,
    };
  }

  /** 条件路由：决定继续调用工具还是结束 */
  function shouldContinue(state: ExpertState): 'tools' | 'finalize' {
    const lastMsg = state.messages[state.messages.length - 1];

    if (
      lastMsg instanceof AIMessage &&
      lastMsg.tool_calls &&
      lastMsg.tool_calls.length > 0 &&
      state.toolLoopCount < maxToolRounds
    ) {
      return 'tools';
    }

    return 'finalize';
  }

  /** finalizeNode — 从消息历史中提取专家结论 JSON */
  async function finalizeNode(
    state: ExpertState,
  ): Promise<Partial<ExpertState>> {
    try {
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
          expertOutput: {
            ...EXPERT_FALLBACK,
            _error: `${outputField} 专家未找到有效的分析回复`,
          },
        };
      }

      const content =
        typeof lastAnalysis.content === 'string'
          ? lastAnalysis.content
          : JSON.stringify(lastAnalysis.content);

      return { expertOutput: parseJson(content, EXPERT_FALLBACK) };
    } catch (err) {
      return {
        expertOutput: {
          ...EXPERT_FALLBACK,
          _error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  const graph = new StateGraph(ExpertSubgraphState)
    .addNode('agent', agentNode)
    .addNode('tools', toolsNode)
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, {
      tools: 'tools',
      finalize: 'finalize',
    })
    .addEdge('tools', 'agent')
    .addEdge('finalize', END);

  return checkpointer ? graph.compile({ checkpointer }) : graph.compile();
}

// ===============================================================
// 专家 System Prompt
// ===============================================================

// ---------------------------------------------------------------
// Functional Expert — 功能分解 & 业务逻辑分析
// ---------------------------------------------------------------
const FUNCTIONAL_EXPERT_SYSTEM_PROMPT = `你是一名**功能需求分析专家**。你的职责是从业务视角对需求进行功能分解和逻辑分析。

## 分析维度
1. **功能模块拆解**：将需求拆解为独立的功能模块，每个模块包含：
   - name：模块名称（简洁明确）
   - description：模块功能描述（2-3 句话）
   - complexity：实现复杂度（low / medium / high）

2. **用户角色识别**：识别所有与系统交互的角色（用户、管理员、外部系统等）

3. **用户故事编写**：为每个角色 × 每个模块编写标准用户故事：
   - 格式："As a <role>, I want <goal>, so that <benefit>"
   - 每一条必须可测试、可交付

4. **验收标准定义**：为每个模块定义可测试的验收条件，覆盖：
   - 正向场景（Happy Path）
   - 边界条件（Edge Cases）
   - 异常场景（Error Handling）

5. **依赖关系识别**：识别与其他系统、模块、数据的依赖：
   - target：依赖目标
   - type：external（外部系统）/ internal（内部模块）
   - impact：blocking（阻塞）/ optional（可选）

6. **业务流程梳理**：识别核心业务流程、状态流转、数据流向

7. **改进建议**：对需求的完整性、一致性、可测试性提出改进建议

## 工具使用规则
- 如果输入包含需求编号（如 REQ-XXX），先调用 query_requirement 或 search_requirement 查询需求详情
- 如果涉及业务实体定义不明确，调用 lookup_entity_definition 查询
- 如果约束条件存在疑问，调用 check_constraint_validity 验证
- 工具调用 1-3 次即可，获取足够信息后必须停止并输出 JSON

## 输出要求（纯 JSON，不要 markdown 代码块包裹）
{
  "functionalDecomposition": [
    { "name": "模块名", "description": "功能描述", "complexity": "medium" }
  ],
  "userRoles": ["角色1", "角色2"],
  "userStories": ["As a <role>, I want <goal>, so that <benefit>"],
  "acceptanceCriteria": [
    { "module": "模块名", "criterion": "可测试的验收条件", "scenario": "happy_path/edge_case/error" }
  ],
  "dependencies": [
    { "target": "依赖目标", "type": "external", "impact": "blocking" }
  ],
  "businessFlows": [{ "name": "流程名", "steps": ["步骤1", "步骤2"], "trigger": "触发条件" }],
  "suggestions": ["改进建议1", "改进建议2"],
  "summary": "功能分析总结（2-3 句话）"
}`;

// ---------------------------------------------------------------
// Performance Expert — 性能 & 可扩展性分析
// ---------------------------------------------------------------
const PERFORMANCE_EXPERT_SYSTEM_PROMPT = `你是一名**性能与可扩展性分析专家**。你的职责是从性能视角评估需求的非功能需求。

## 分析维度
1. **性能指标识别**：识别需求的性能关键指标（KPI）：
   - 响应时间（P50 / P95 / P99）
   - 吞吐量（TPS / QPS）
   - 并发用户数
   - 数据量级

2. **可扩展性评估**：
   - 水平扩展能力（是否支持多实例部署）
   - 垂直扩展能力（资源增加对性能的提升空间）
   - 瓶颈分析与预测

3. **资源需求估算**：
   - CPU / 内存 / 存储 / 网络带宽需求
   - 数据库连接池、缓存策略
   - CDN / 负载均衡需求

4. **高可用要求**：
   - 可用性目标（99.9% / 99.99%）
   - 故障恢复时间（RTO）
   - 数据恢复点（RPO）

5. **性能风险识别**：
   - 高并发场景下的竞态条件
   - 大数据量下的查询性能
   - 第三方服务超时与降级

6. **优化建议**：缓存策略、索引优化、异步化、读写分离等

## 工具使用规则
- 如果需要参考性能标准文档，调用 read_file 读取 workspace 中的规范文件
- 工具调用 0-2 次即可，工具只是辅助

## 输出要求（纯 JSON，不要 markdown 代码块包裹）
{
  "performanceMetrics": {
    "responseTime": { "p50": "<value>", "p95": "<value>", "p99": "<value>" },
    "throughput": { "tps": "<value>", "description": "说明" },
    "concurrency": { "maxUsers": "<value>", "description": "说明" },
    "dataVolume": { "estimate": "<value>", "description": "说明" }
  },
  "scalability": {
    "horizontalScaling": "支持/部分支持/不支持",
    "verticalScaling": "支持/部分支持/不支持",
    "bottlenecks": ["潜在瓶颈1", "潜在瓶颈2"],
    "assessment": "可扩展性评估总结"
  },
  "resourceEstimation": {
    "cpu": "需求描述",
    "memory": "需求描述",
    "storage": "需求描述",
    "network": "需求描述",
    "cacheStrategy": "缓存策略建议",
    "loadBalancing": "是否需要负载均衡及原因"
  },
  "highAvailability": {
    "availabilityTarget": "99.9% / 99.99%",
    "rto": "恢复时间目标",
    "rpo": "数据恢复点目标",
    "disasterRecovery": "灾备方案建议"
  },
  "performanceRisks": [
    { "risk": "风险描述", "scenario": "触发场景", "severity": "high/medium/low", "mitigation": "缓解措施" }
  ],
  "optimizationSuggestions": ["优化建议1", "优化建议2"],
  "summary": "性能分析总结（2-3 句话）"
}`;

// ---------------------------------------------------------------
// Security Expert — 安全分析
// ---------------------------------------------------------------
const SECURITY_EXPERT_SYSTEM_PROMPT = `你是一名**安全分析专家**。你的职责是识别需求中的安全风险并提供防护建议。

## 分析维度
1. **认证与授权**：
   - 用户身份认证方式（密码、SSO、OAuth2.0、MFA）
   - 权限模型（RBAC / ABAC / ACL）
   - 会话管理（JWT、Session、Token 刷新策略）

2. **数据安全**：
   - 敏感数据识别（PII、密码、支付信息、健康数据）
   - 数据加密（传输层 TLS、存储层 AES）
   - 数据脱敏与匿名化需求
   - 数据保留与删除策略

3. **网络安全**：
   - API 安全（Rate Limiting、Input Validation、CORS）
   - 通信加密（HTTPS、mTLS）
   - DDoS 防护需求

4. **安全漏洞分析**（OWASP Top 10 视角）：
   - SQL 注入 / XSS / CSRF 风险
   - 不安全的反序列化
   - 日志注入与敏感信息泄露
   - 依赖库漏洞

5. **合规安全**：
   - 审计日志需求
   - 访问控制审计
   - 安全事件响应流程

6. **安全建议**：具体可落地的安全加固方案

## 工具使用规则
- 如果需求涉及认证、权限、支付，先调用相关工具查询现有系统的安全策略
- 工具调用 0-2 次即可

## 输出要求（纯 JSON，不要 markdown 代码块包裹）
{
  "authentication": {
    "requiredMethods": ["password", "sso", "oauth2", "mfa"],
    "sessionStrategy": "JWT / Session / Token",
    "assessment": "认证方案评估"
  },
  "authorization": {
    "model": "RBAC / ABAC / ACL",
    "roleDefinitions": ["角色1", "角色2"],
    "assessment": "授权方案评估"
  },
  "dataSecurity": {
    "sensitiveData": ["数据类型1", "数据类型2"],
    "encryptionRequirements": {
      "transit": "TLS 1.3 / mTLS",
      "storage": "AES-256 / 其他",
      "masking": "需要脱敏的字段"
    },
    "dataRetention": "数据保留与删除策略"
  },
  "apiSecurity": {
    "rateLimit": "建议的限流策略",
    "inputValidation": "输入校验要求",
    "corsPolicy": "跨域策略建议"
  },
  "vulnerabilities": [
    { "type": "OWASP 分类", "description": "风险描述", "likelihood": "high/medium/low", "severity": "high/medium/low", "mitigation": "修复建议" }
  ],
  "auditRequirements": ["审计日志需求1", "审计日志需求2"],
  "securityRecommendations": ["安全建议1", "安全建议2"],
  "overallRiskLevel": "low / medium / high / critical",
  "summary": "安全分析总结（2-3 句话）"
}`;

// ---------------------------------------------------------------
// Compliance Expert — 合规 & 治理分析
// ---------------------------------------------------------------
const COMPLIANCE_EXPERT_SYSTEM_PROMPT = `你是一名**合规与治理分析专家**。你的职责是评估需求的合规性要求并提供治理建议。

## 分析维度
1. **法规合规**：
   - 数据保护法规（GDPR、《个人信息保护法》、CCPA）
   - 行业法规（PCI-DSS、HIPAA、SOX）
   - 等保要求（等级保护 2.0）

2. **数据治理**：
   - 数据分类与分级（公开 / 内部 / 机密 / 绝密）
   - 数据生命周期管理
   - 数据主权与跨境传输要求
   - 数据质量与一致性要求

3. **审计与可追溯性**：
   - 操作审计日志
   - 变更管理流程
   - 版本追溯能力
   - 不可篡改性要求

4. **标准与认证**：
   - ISO 27001 / ISO 27701
   - SOC 2 Type II
   - 行业特定标准

5. **隐私保护**：
   - 隐私政策与用户告知
   - 用户数据权利（访问、更正、删除、可携带）
   - Cookie 与追踪合规
   - 儿童数据保护

6. **合规风险**：
   - 不合规的法律后果
   - 处罚风险评估
   - 合规差距分析

7. **治理建议**：合规落地路径与优先级

## 工具使用规则
- 如需查阅合规标准文档，调用 read_file 读取 workspace 中的规范文件
- 工具调用 0-2 次即可

## 输出要求（纯 JSON，不要 markdown 代码块包裹）
{
  "applicableRegulations": [
    { "name": "法规名称", "applicable": true/false, "reason": "适用性判断依据", "requirements": ["要求1", "要求2"] }
  ],
  "dataGovernance": {
    "classification": "公开 / 内部 / 机密 / 绝密",
    "lifecycleManagement": "数据生命周期各阶段要求",
    "dataSovereignty": "数据跨境传输评估",
    "dataQuality": "数据质量要求"
  },
  "auditRequirements": {
    "operationLogs": "操作日志要求",
    "changeManagement": "变更管理要求",
    "traceability": "追溯性要求",
    "immutability": "不可篡改要求"
  },
  "applicableStandards": [
    { "standard": "标准名称", "mandatory": true/false, "scope": "适用范围" }
  ],
  "privacyRequirements": {
    "userConsent": "用户同意要求",
    "dataRights": ["访问", "更正", "删除", "可携带"],
    "cookiePolicy": "Cookie 策略要求",
    "dpa": "是否需要数据处理协议"
  },
  "complianceRisks": [
    { "risk": "合规风险描述", "severity": "high/medium/low", "penalty": "潜在处罚", "gapAnalysis": "差距分析" }
  ],
  "governanceRecommendations": ["治理建议1", "治理建议2"],
  "priority": "合规优先级：immediate / short-term / long-term",
  "summary": "合规分析总结（2-3 句话）"
}`;

// ===============================================================
// 专家工厂函数
// ===============================================================

/**
 * 创建功能分析专家子图
 *
 * 适用工具：需求查询、实体定义查询、约束校验
 */
export function createFunctionalExpert(model: BaseChatModel) {
  // 延迟导入以避免循环依赖 — 实际工具在调用方注入
  // 这里使用空数组作为默认，由 createAnalysisSupervisorSubGraph 在构造时覆盖
  return (tools: StructuredToolInterface[]) =>
    createExpertSubGraph({
      model,
      tools,
      systemPrompt: FUNCTIONAL_EXPERT_SYSTEM_PROMPT,
      outputField: 'functionalAnalysis',
      maxToolRounds: 4,
    });
}

/**
 * 创建性能分析专家子图
 *
 * 适用工具：文件读取（查阅性能规范）
 */
export function createPerformanceExpert(model: BaseChatModel) {
  return (tools: StructuredToolInterface[]) =>
    createExpertSubGraph({
      model,
      tools,
      systemPrompt: PERFORMANCE_EXPERT_SYSTEM_PROMPT,
      outputField: 'performanceAnalysis',
      maxToolRounds: 3,
    });
}

/**
 * 创建安全分析专家子图
 *
 * 适用工具：冲突检测、文件读取
 */
export function createSecurityExpert(model: BaseChatModel) {
  return (tools: StructuredToolInterface[]) =>
    createExpertSubGraph({
      model,
      tools,
      systemPrompt: SECURITY_EXPERT_SYSTEM_PROMPT,
      outputField: 'securityAnalysis',
      maxToolRounds: 3,
    });
}

/**
 * 创建合规分析专家子图
 *
 * 适用工具：文件读取（查阅合规标准）
 */
export function createComplianceExpert(model: BaseChatModel) {
  return (tools: StructuredToolInterface[]) =>
    createExpertSubGraph({
      model,
      tools,
      systemPrompt: COMPLIANCE_EXPERT_SYSTEM_PROMPT,
      outputField: 'complianceAnalysis',
      maxToolRounds: 3,
    });
}

// ===============================================================
// Supervisor — 决策节点
// ===============================================================

export type ExpertName =
  | 'functional'
  | 'performance'
  | 'security'
  | 'compliance';

/** Supervisor 结构化输出 Schema */
const SupervisorDecisionSchema = z.object({
  activeExperts: z
    .array(z.enum(['functional', 'performance', 'security', 'compliance']))
    .describe(
      '本次分析需要激活的专家列表。根据需求的特征选择合适的专家，' +
        '至少选择 1 个，最多 4 个。functional 负责功能分解与业务逻辑，' +
        'performance 负责性能与可扩展性，security 负责安全分析，' +
        'compliance 负责合规与治理。',
    ),
  reasoning: z
    .string()
    .describe('选择这些专家的推理依据，简要说明为什么选择/不选择每个专家'),
});

type SupervisorDecision = z.infer<typeof SupervisorDecisionSchema>;

const SUPERVISOR_SYSTEM_PROMPT = `你是一位**需求分析编排主管（Supervisor）**。你的任务是根据需求内容，判断需要哪些专家参与分析。

## 可用的专家

| 专家 | 职责 | 适用场景 |
|------|------|----------|
| **functional** | 功能分解、用户故事、验收标准、依赖关系、业务流程 | 几乎所有需求都需要，除非是纯技术基础设施改造 |
| **performance** | 性能指标、可扩展性、高可用、资源估算 | 高并发系统、大数据量处理、对响应时间有严格要求、需要 SLA 保障 |
| **security** | 认证授权、数据安全、API 安全、漏洞分析 | 涉及用户认证、支付、敏感数据（PII）、权限管理、对外 API |
| **compliance** | 法规合规、数据治理、审计追溯、隐私保护 | 涉及个人数据、金融/医疗/政务行业、跨境业务、需要等保认证 |

## 决策规则

1. **functional** 是默认必选的（除非需求是纯基础设施运维类，不含任何功能逻辑）
2. 如果需求涉及以下关键词，**必须激活 security**：
   - 登录、注册、认证、权限、角色、密码
   - 支付、交易、订单、资金
   - 敏感数据、个人信息、隐私
   - API、接口（对外暴露）
3. 如果需求涉及以下关键词，**必须激活 performance**：
   - 高并发、大量用户、实时、低延迟
   - 大数据、海量、百万/千万级
   - 秒杀、抢购、排行榜
   - 99.9%、SLA、容灾
4. 如果需求涉及以下关键词，**必须激活 compliance**：
   - 金融、银行、保险、证券
   - 医疗、医院、患者、健康数据
   - 政府、政务、公安
   - GDPR、个人信息保护法、等保、PCI-DSS
   - 审计、合规、监管
5. 对于简单的 CRUD 需求或内部工具，可能只需要 functional
6. 宁可多选 1 个专家（多维度覆盖），也不要漏选关键维度

请根据以上规则判断需要激活的专家列表。`;

/**
 * 创建 Supervisor 节点函数
 *
 * 使用 withStructuredOutput 获取结构化的专家选择结果。
 * model 通过参数注入，不在内部调用 createChatModel()。
 */
export function createSupervisorNode(model: BaseChatModel) {
  const supervisorModel = model.withStructuredOutput(SupervisorDecisionSchema);

  return async function supervisorNode(
    state: SupervisorState,
  ): Promise<Partial<SupervisorState>> {
    try {
      const result: SupervisorDecision = await supervisorModel.invoke([
        new SystemMessage(SUPERVISOR_SYSTEM_PROMPT),
        new HumanMessage(
          `## 原始需求\n${state.input}\n\n` +
            `## 已抽取结构化字段\n${JSON.stringify(state.extracted, null, 2)}\n\n` +
            `## 澄清结果\n${JSON.stringify(state.clarified, null, 2)}\n\n` +
            `请根据以上信息，判断需要激活哪些专家参与分析。`,
        ),
      ]);

      return {
        activeExperts: result.activeExperts,
        supervisorReasoning: result.reasoning,
      };
    } catch (err) {
      // 降级：默认激活所有专家
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[Supervisor] 决策失败，降级为全专家模式:', errorMsg);
      return {
        activeExperts: ['functional', 'performance', 'security', 'compliance'],
        supervisorReasoning: `决策异常降级：${errorMsg}`,
      };
    }
  };
}

// ===============================================================
// Aggregator — 汇总节点
// ===============================================================

const AGGREGATOR_SYSTEM_PROMPT = `你是一名**需求分析汇总专家**。你的任务是将多位专家的分析结论合并为一份统一的需求分析报告。

## 合并规则
1. **功能分解**：以 functional 专家的 functionalDecomposition 为准
2. **用户故事**：以 functional 专家的 userStories 为准
3. **验收标准**：以 functional 专家的 acceptanceCriteria 为准
4. **依赖关系**：以 functional 专家的 dependencies 为准
5. **性能要求**：从 performance 专家的输出中提取关键指标，补充到 suggestions
6. **安全要求**：从 security 专家的输出中提取关键风险，重要项补充到 suggestions
7. **合规要求**：从 compliance 专家的输出中提取强制性要求，补充到 suggestions
8. **改进建议**：合并所有专家（仅被激活的）的 suggestions，去重

## 重要约束
- 只合并 **activeExperts 中实际被选择** 的专家结论
- 不要编造信息，只使用专家实际输出的内容
- 如果某个维度的专家未被激活，该维度留空但不要编造
- suggestions 中标注每条建议的来源专家

## 输出要求（纯 JSON，不要 markdown 代码块包裹）
{
  "functionalDecomposition": [...],
  "userStories": [...],
  "acceptanceCriteria": [...],
  "dependencies": [...],
  "suggestions": ["[functional] 建议1", "[security] 建议2", ...],
  "performanceNotes": "性能分析摘要（如该维度未激活则写 '未评估'）",
  "securityNotes": "安全分析摘要（如该维度未激活则写 '未评估'）",
  "complianceNotes": "合规分析摘要（如该维度未激活则写 '未评估'）",
  "mergeSummary": "汇总总结（3-5 句话，概述各维度分析结论）"
}`;

/**
 * 创建 Aggregator 节点函数
 *
 * model 通过参数注入。
 */
export function createAggregatorNode(model: BaseChatModel) {
  return async function aggregatorNode(
    state: SupervisorState,
  ): Promise<Partial<SupervisorState>> {
    try {
      const activeExperts = state.activeExperts ?? [];

      // 收集被激活专家的输出
      const expertReports: string[] = [];
      const allSuggestions: string[] = [];
      const fallbackResult = getAggregatorFallback(activeExperts);

      if (activeExperts.includes('functional') && state.functionalAnalysis) {
        expertReports.push(
          `## 功能分析专家结论\n${JSON.stringify(state.functionalAnalysis, null, 2)}`,
        );
      }

      if (activeExperts.includes('performance') && state.performanceAnalysis) {
        expertReports.push(
          `## 性能分析专家结论\n${JSON.stringify(state.performanceAnalysis, null, 2)}`,
        );
      }

      if (activeExperts.includes('security') && state.securityAnalysis) {
        expertReports.push(
          `## 安全分析专家结论\n${JSON.stringify(state.securityAnalysis, null, 2)}`,
        );
      }

      if (activeExperts.includes('compliance') && state.complianceAnalysis) {
        expertReports.push(
          `## 合规分析专家结论\n${JSON.stringify(state.complianceAnalysis, null, 2)}`,
        );
      }

      // 如果没有任何专家输出，返回降级结果
      if (expertReports.length === 0) {
        return { analysisResult: fallbackResult };
      }

      const aggregatorModel = model;
      const response = await aggregatorModel.invoke([
        new SystemMessage(AGGREGATOR_SYSTEM_PROMPT),
        new HumanMessage(
          `## 原始需求\n${state.input}\n\n` +
            `## 激活的专家\n${activeExperts.join(', ')}\n\n` +
            `${expertReports.join('\n\n---\n\n')}\n\n` +
            `请按照合并规则，将以上专家结论合并为统一的分析报告 JSON。`,
        ),
      ]);

      const content =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      return { analysisResult: parseJson(content, fallbackResult) };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[Aggregator] 汇总失败:', errorMsg);
      return {
        analysisResult: {
          ...getAggregatorFallback(state.activeExperts ?? []),
          _error: errorMsg,
        },
      };
    }
  };
}

/**
 * Aggregator 降级结果：当汇总失败时，尝试从原始专家输出中提取关键信息
 */
function getAggregatorFallback(
  activeExperts: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    functionalDecomposition: [],
    userStories: [],
    acceptanceCriteria: [],
    dependencies: [],
    suggestions: ['⚠️ 汇总节点降级：请人工复核各专家原始输出'],
  };

  if (!activeExperts.includes('functional')) {
    result.suggestions = [
      ...(result.suggestions as string[]),
      '[降级] 功能专家未被激活，功能分解可能不完整',
    ];
  }

  return result;
}

// ===============================================================
// Supervisor 子图 State
// ===============================================================

/**
 * Supervisor 子图 State
 *
 * 在主图 State 基础上增加了 Supervisor 架构特有的字段：
 * - activeExperts：Supervisor 选择的专家列表
 * - supervisorReasoning：Supervisor 决策理由（调试用）
 * - 四个专家输出字段
 * - analysisResult：Aggregator 最终合并结果
 */
export const SupervisorSubgraphState = Annotation.Root({
  input: Annotation<string>,
  extracted: Annotation<Record<string, unknown>>,
  clarified: Annotation<Record<string, unknown>>,
  // Supervisor 决策
  activeExperts: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  supervisorReasoning: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  // 各专家输出
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
  // Aggregator 最终输出
  analysisResult: Annotation<Record<string, unknown>>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),
  // 专家工具轮次计数（各专家独立计数，此处取最大值用于日志）
  toolLoopCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
});

export type SupervisorState = typeof SupervisorSubgraphState.State;

// ===============================================================
// 条件路由：根据 activeExperts 并行分发到对应专家
// ===============================================================

/**
 * routeToExperts — 条件边函数，返回 Send[] 以触发并行执行
 *
 * 将 activeExperts 映射为对应的专家节点名，使用 Send
 * 实现真正的并行专家分析。
 */
function routeToExperts(state: SupervisorState): Send[] {
  const expertNodeMap: Record<string, string> = {
    functional: 'functional_expert',
    performance: 'performance_expert',
    security: 'security_expert',
    compliance: 'compliance_expert',
  };

  const sends: Send[] = [];
  for (const expert of state.activeExperts) {
    const nodeName = expertNodeMap[expert];
    if (nodeName) {
      sends.push(new Send(nodeName, {}));
    }
  }

  // 降级：如果 supervisor 没有选择任何专家，至少激活 functional
  if (sends.length === 0) {
    console.warn('[Supervisor] 未选择任何专家，降级为仅激活 functional');
    sends.push(new Send('functional_expert', {}));
  }

  return sends;
}

// ===============================================================
// Expert wrapper nodes — 将编译后的专家子图包装为节点函数
// ===============================================================

/**
 * 创建专家包装节点
 *
 * 将编译后的专家子图包装为可在 Supervisor 图中直接使用的节点函数。
 * 负责状态映射：SupervisorState → ExpertState → 提取 expertOutput → SupervisorState
 */
function makeExpertWrapperNode(
  expertSubgraph: ReturnType<typeof createExpertSubGraph>,
  outputField: keyof SupervisorState,
  expertName: string,
) {
  return async function expertWrapperNode(
    state: SupervisorState,
  ): Promise<Partial<SupervisorState>> {
    try {
      const result = await expertSubgraph.invoke({
        input: state.input,
        extracted: state.extracted ?? {},
        clarified: state.clarified ?? {},
        messages: [],
        toolLoopCount: 0,
      });

      const output = (result as Record<string, unknown>).expertOutput ?? {};

      return {
        [outputField]: output,
        toolLoopCount: Math.max(
          state.toolLoopCount ?? 0,
          ((result as Record<string, unknown>).toolLoopCount as number) ?? 0,
        ),
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[${expertName}] 专家执行失败:`, errorMsg);
      return {
        [outputField]: {
          _error: errorMsg,
          suggestions: [`${expertName} 专家执行异常，请人工复核`],
        },
      };
    }
  };
}

// ===============================================================
// createAnalysisSupervisorSubGraph — 主工厂函数
// ===============================================================

/**
 * 创建 Supervisor + 多专家分析子图
 *
 * 图结构：
 *   START → supervisor
 *            ├─(Send)→ functional_expert  ─┐
 *            ├─(Send)→ performance_expert ─┤
 *            ├─(Send)→ security_expert    ─┤  (并行)
 *            ├─(Send)→ compliance_expert  ─┘
 *            └─(汇聚)→ aggregator → END
 *
 * 参数：
 * - model：LLM 实例（通过参数注入，不在内部调用 createChatModel）
 * - expertTools：各专家的工具集配置
 *
 * 与原有 createAnalysisSubGraph 的关系：
 * - createAnalysisSubGraph 是单 Agent ReAct 子图（第 8 章）
 * - createAnalysisSupervisorSubGraph 是 Supervisor + 多专家架构（第 9 章）
 * - 两者可通过 analysisSubgraphNode 中的开关切换
 */
export function createAnalysisSupervisorSubGraph({
  model,
  expertTools = {},
  checkpointer,
}: {
  model: BaseChatModel;
  expertTools?: {
    functional?: StructuredToolInterface[];
    performance?: StructuredToolInterface[];
    security?: StructuredToolInterface[];
    compliance?: StructuredToolInterface[];
  };
  checkpointer?: BaseCheckpointSaver | boolean;
}) {
  // 创建各专家子图
  const functionalExpertGraph = createExpertSubGraph({
    model,
    tools: expertTools.functional ?? [],
    systemPrompt: FUNCTIONAL_EXPERT_SYSTEM_PROMPT,
    outputField: 'functionalAnalysis',
    maxToolRounds: 4,
    checkpointer,
  });

  const performanceExpertGraph = createExpertSubGraph({
    model,
    tools: expertTools.performance ?? [],
    systemPrompt: PERFORMANCE_EXPERT_SYSTEM_PROMPT,
    outputField: 'performanceAnalysis',
    maxToolRounds: 3,
    checkpointer,
  });

  const securityExpertGraph = createExpertSubGraph({
    model,
    tools: expertTools.security ?? [],
    systemPrompt: SECURITY_EXPERT_SYSTEM_PROMPT,
    outputField: 'securityAnalysis',
    maxToolRounds: 3,
    checkpointer,
  });

  const complianceExpertGraph = createExpertSubGraph({
    model,
    tools: expertTools.compliance ?? [],
    systemPrompt: COMPLIANCE_EXPERT_SYSTEM_PROMPT,
    outputField: 'complianceAnalysis',
    maxToolRounds: 3,
    checkpointer,
  });

  // 创建 Supervisor 和 Aggregator 节点
  const supervisorNode = createSupervisorNode(model);
  const aggregatorNode = createAggregatorNode(model);

  // 创建专家包装节点
  const functionalNode = makeExpertWrapperNode(
    functionalExpertGraph,
    'functionalAnalysis',
    'Functional',
  );
  const performanceNode = makeExpertWrapperNode(
    performanceExpertGraph,
    'performanceAnalysis',
    'Performance',
  );
  const securityNode = makeExpertWrapperNode(
    securityExpertGraph,
    'securityAnalysis',
    'Security',
  );
  const complianceNode = makeExpertWrapperNode(
    complianceExpertGraph,
    'complianceAnalysis',
    'Compliance',
  );

  // 构建图
  const graph = new StateGraph(SupervisorSubgraphState)
    .addNode('supervisor', supervisorNode)
    .addNode('functional_expert', functionalNode as any)
    .addNode('performance_expert', performanceNode as any)
    .addNode('security_expert', securityNode as any)
    .addNode('compliance_expert', complianceNode as any)
    .addNode('aggregator', aggregatorNode)
    .addEdge(START, 'supervisor')
    .addConditionalEdges('supervisor', routeToExperts)
    .addEdge('functional_expert', 'aggregator')
    .addEdge('performance_expert', 'aggregator')
    .addEdge('security_expert', 'aggregator')
    .addEdge('compliance_expert', 'aggregator')
    .addEdge('aggregator', END);

  return checkpointer ? graph.compile({ checkpointer }) : graph.compile();
}
