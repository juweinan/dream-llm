// ---------------------------------------------------------------
// 10.7 模型分级 — 按角色默认 + 运行时覆盖
//
// 用途：为 Multi-Agent 图中 9 个节点角色声明默认模型配置，
// 并根据预算状况 / 需求复杂度在运行时决定是否降级。
//
// 10.7 只负责"声明 + 决策"（纯函数，零副作用），
// "接入"（把结果喂给 createChatModel）放到 10.9 再讨论。
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// 1. AgentName — 图中的 9 种节点角色
// ---------------------------------------------------------------
export type AgentName =
  | 'supervisor'
  | 'functional_expert'
  | 'performance_expert'
  | 'security_expert'
  | 'compliance_expert'
  | 'risk_agent'
  | 'summary_agent'
  | 'critic'
  | 'compressor';

// ---------------------------------------------------------------
// 2. AgentModelSet — 9 个角色各绑定一个 modelConfigId
// ---------------------------------------------------------------
export interface AgentModelSet {
  supervisorModelConfigId: string;
  functionalModelConfigId: string;
  performanceModelConfigId: string;
  securityModelConfigId: string;
  complianceModelConfigId: string;
  riskModelConfigId: string;
  summaryModelConfigId: string;
  criticModelConfigId: string;
  compressorModelConfigId: string;
}

// ---------------------------------------------------------------
// 3. DEFAULT_AGENT_MODEL_SET — 设计期默认分配
// ---------------------------------------------------------------
export const DEFAULT_AGENT_MODEL_SET: AgentModelSet = {
  // 高风险 = supervisor + 安全 + 合规 + 总结 + 评审 → gpt-4o
  supervisorModelConfigId: 'demo-gpt-4o',
  securityModelConfigId: 'demo-gpt-4o',
  complianceModelConfigId: 'demo-gpt-4o',
  summaryModelConfigId: 'demo-gpt-4o',
  criticModelConfigId: 'demo-gpt-4o',

  // 中等风险 = 功能 / 性能 / 风险 → gpt-4o-mini
  functionalModelConfigId: 'demo-gpt-4o-mini',
  performanceModelConfigId: 'demo-gpt-4o-mini',
  riskModelConfigId: 'demo-gpt-4o-mini',

  // 摘要压缩非面向用户 → deepseek-chat（最便宜）
  compressorModelConfigId: 'demo-deepseek-chat',
};

// ---------------------------------------------------------------
// 4. HIGH_RISK_AGENTS — 高风险角色（预算紧张时不允许降级）
// ---------------------------------------------------------------
export const HIGH_RISK_AGENTS: AgentName[] = [
  'supervisor',
  'security_expert',
  'compliance_expert',
  'critic',
  'summary_agent',
];

// ---------------------------------------------------------------
// 5. AGENT_TO_CONFIG_KEY — AgentName → AgentModelSet 字段名
// ---------------------------------------------------------------
export const AGENT_TO_CONFIG_KEY: Record<AgentName, keyof AgentModelSet> = {
  supervisor: 'supervisorModelConfigId',
  functional_expert: 'functionalModelConfigId',
  performance_expert: 'performanceModelConfigId',
  security_expert: 'securityModelConfigId',
  compliance_expert: 'complianceModelConfigId',
  risk_agent: 'riskModelConfigId',
  summary_agent: 'summaryModelConfigId',
  critic: 'criticModelConfigId',
  compressor: 'compressorModelConfigId',
};

// ---------------------------------------------------------------
// 6. resolveModelForAgent — 运行时决策（纯函数）
// ---------------------------------------------------------------
export interface ResolveModelInput {
  agentName: AgentName;
  /** 角色-模型绑定表，未传时使用 DEFAULT_AGENT_MODEL_SET */
  defaultModelSet?: AgentModelSet;
  /** 需求复杂度，用于降级判断 */
  requirementComplexity?: 'low' | 'medium' | 'high';
  /** 预算使用情况 */
  budgetStatus?: { usedPercent: number };
}

export interface ResolveModelResult {
  selectedModelConfigId: string;
  overrideReason: string | null;
}

/**
 * 按优先级顺序决定节点该用哪个 modelConfigId。
 *
 * 决策顺序（严格）：
 * 1. budgetPercent ≥ 100 且 compressor → 豁免（仍用默认）
 * 2. budgetPercent ≥ 100 其余 agent → budget_exceeded_reject
 * 3. budgetPercent ∈ [80, 100) 且非高风险 → 降级到 compressor model
 * 4. requirementComplexity === 'low' 且非高风险 → 降级到 compressor model
 * 5. 否则返回默认 modelConfigId
 */
export function resolveModelForAgent(
  input: ResolveModelInput,
): ResolveModelResult {
  const modelSet = input.defaultModelSet ?? DEFAULT_AGENT_MODEL_SET;
  const configKey = AGENT_TO_CONFIG_KEY[input.agentName];
  const defaultConfigId = modelSet[configKey];

  const budgetPercent = input.budgetStatus?.usedPercent;
  const isHighRisk = HIGH_RISK_AGENTS.includes(input.agentName);

  // Step 1: budgetPercent ≥ 100 → compressor 豁免
  if (budgetPercent != null && budgetPercent >= 100) {
    if (input.agentName === 'compressor') {
      return {
        selectedModelConfigId: defaultConfigId,
        overrideReason: null,
      };
    }
    // Step 2: 其余 agent 一律拒绝
    return {
      selectedModelConfigId: defaultConfigId,
      overrideReason: 'budget_exceeded_reject',
    };
  }

  // Step 3: budgetPercent ∈ [80, 100) → 非高风险降级
  if (
    budgetPercent != null &&
    budgetPercent >= 80 &&
    budgetPercent < 100 &&
    !isHighRisk
  ) {
    return {
      selectedModelConfigId: modelSet.compressorModelConfigId,
      overrideReason: `budget_tight_downgrade (${budgetPercent}%)`,
    };
  }

  // Step 4: requirementComplexity === 'low' → 非高风险降级
  if (input.requirementComplexity === 'low' && !isHighRisk) {
    return {
      selectedModelConfigId: modelSet.compressorModelConfigId,
      overrideReason: 'low_complexity_downgrade',
    };
  }

  // Step 5: 默认路径
  return {
    selectedModelConfigId: defaultConfigId,
    overrideReason: null,
  };
}
