// ---------------------------------------------------------------
// 10.9 预算策略 — 预算阈值 + 自动降级 + 拒绝
//
// 用途：在 10.7 模型分级和 10.8 token usage 持久化之上，
// 根据当月预算消耗比例决定每个 Agent 节点是否允许执行、
// 是否需要降级、还是直接拒绝。
//
// budget-policy 是纯函数模块，零副作用，零 IO。
// 职责分离：
//   - resolveBudgetAction   → "是否执行 / 是否降级 / 是否拒绝"
//   - resolveModelForAgent  → "选哪个 modelConfigId"
//   两者独立调用，组合逻辑由使用方控制。
// ---------------------------------------------------------------

import { HIGH_RISK_AGENTS } from './agent-model-set';
import type { AgentName } from './agent-model-set';

// ---------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------

/**
 * 预算决策动作。
 * - allow:     正常执行，用角色默认（或更高配）模型
 * - downgrade: 降级到廉价模型（compressor 级别）后执行
 * - reject:    预算超限，拒绝本次调用（compressor 豁免）
 */
export type BudgetAction = 'allow' | 'downgrade' | 'reject';

export interface BudgetPolicyInput {
  /** 当月预算消耗百分比（0-100+），例如 85 表示已用 85% */
  budgetUsedPercent: number;
  /** Agent 角色名 */
  agentName: AgentName;
  /** 需求风险等级（目前预留，后续版本可辅助判断降级力度） */
  requirementRiskLevel?: 'low' | 'medium' | 'high';
}

export interface BudgetPolicyResult {
  action: BudgetAction;
  /** 可供日志/审计的可读原因，包含具体百分比 */
  reason: string;
}

// ---------------------------------------------------------------
// resolveBudgetAction
// ---------------------------------------------------------------

/**
 * 根据当前预算消耗比例，决定对某个 Agent 节点采取什么动作。
 *
 * 决策顺序（严格）：
 *
 * 1. budgetUsedPercent < 80：
 *    → allow，reason = "budget OK (X%)"
 *
 * 2. budgetUsedPercent ∈ [80, 100)：
 *    - agent ∈ HIGH_RISK_AGENTS → allow
 *      reason = "high-risk agent, no downgrade (X%)"
 *    - 否则 → downgrade
 *      reason = "budget tight, low-risk agent can downgrade (X%)"
 *
 * 3. budgetUsedPercent ≥ 100：
 *    - agent === 'compressor' → allow
 *      reason = "compressor allowed even over budget (cost reduction purpose)"
 *    - 否则 → reject
 *      reason = "budget exceeded (X%)"
 */
export function resolveBudgetAction(
  input: BudgetPolicyInput,
): BudgetPolicyResult {
  const { budgetUsedPercent, agentName } = input;

  // ---- Zone 1: 预算充裕（< 80%） ----
  if (budgetUsedPercent < 80) {
    return {
      action: 'allow',
      reason: `budget OK (${budgetUsedPercent}%)`,
    };
  }

  // ---- Zone 2: 预算紧张（[80, 100)） ----
  if (budgetUsedPercent < 100) {
    if (HIGH_RISK_AGENTS.includes(agentName)) {
      return {
        action: 'allow',
        reason: `high-risk agent, no downgrade (${budgetUsedPercent}%)`,
      };
    }
    return {
      action: 'downgrade',
      reason: `budget tight, low-risk agent can downgrade (${budgetUsedPercent}%)`,
    };
  }

  // ---- Zone 3: 预算超限（≥ 100%） ----
  if (agentName === 'compressor') {
    return {
      action: 'allow',
      reason:
        'compressor allowed even over budget (cost reduction purpose)',
    };
  }

  return {
    action: 'reject',
    reason: `budget exceeded (${budgetUsedPercent}%)`,
  };
}

// ---------------------------------------------------------------
// 10.9.3 接入示例 —— 如何把 budget-policy + model-set + usage
// 串联接入第九章 Multi-Agent 图的单个节点
//
// ⚠️ 以下代码为接入思路示例，不表示主图已经完成集成。
//    实际接入到 experts.ts 由后续章节决定。
// ---------------------------------------------------------------
//
// // ---- 依赖 ----
// import { resolveBudgetAction } from '../cost/budget-policy';
// import { resolveModelForAgent } from '../cost/agent-model-set';
// import { withTokenUsage } from '../cost/with-token-usage';
// import { createChatModel } from '../model.factory';
// import { TokenUsageService } from '../cost/token-usage.service';
//
// const MONTHLY_BUDGET_USD = 50; // 硬上限，可从配置读取
//
// // ---- 在某个图节点函数内 ----
// async function supervisedNodeInvoke(
//   state: State,
//   usageService: TokenUsageService,
// ) {
//   const agentName: AgentName = 'supervisor';
//   const stats = await usageService.getMonthlyStats();
//   const budgetPercent =
//     MONTHLY_BUDGET_USD > 0
//       ? Math.round((stats.totalCost / MONTHLY_BUDGET_USD) * 100)
//       : 0;
//
//   // Step 1: 预算决策
//   const { action, reason } = resolveBudgetAction({
//     budgetUsedPercent: budgetPercent,
//     agentName,
//   });
//
//   if (action === 'reject') {
//     // 返回占位输出，不调用模型
//     return {
//       messages: [
//         new AIMessage(`⛔ 预算超限，${agentName} 暂停执行。${reason}`),
//       ],
//     };
//   }
//
//   // Step 2: 模型选择（可能降级）
//   const { selectedModelConfigId, overrideReason } =
//     resolveModelForAgent({
//       agentName,
//       budgetStatus: { usedPercent: budgetPercent },
//     });
//
//   // Step 3: 创建模型实例
//   const model = createChatModel({
//     modelConfigId: selectedModelConfigId,
//   });
//
//   // Step 4: 调用 + 自动采集 usage
//   const result = await withTokenUsage(
//     {
//       graphName: 'requirement-analysis',
//       nodeName: 'supervisor',
//       agentName,
//       modelName: model.model ?? selectedModelConfigId,
//       modelConfigId: selectedModelConfigId,
//       overrideReason: overrideReason ?? undefined,
//     },
//     usageService,
//     () => model.invoke(state.messages),
//   );
//
//   return { messages: [result] };
// }
