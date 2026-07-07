import { Injectable, Logger } from '@nestjs/common';
import {
  runAnalysisGraph,
  GraphOrchestrationResult,
} from '../graph/requirement-analysis-graph';
import type { AIUIResponse, UIComponent } from '../ui-protocol/ui-types';

// ---------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------

interface ExtractResult {
  title?: string;
  action?: string;
  constraints?: string[];
  entities?: string[];
  priority?: string;
  background?: string;
}

interface ClarifyResult {
  needsClarification: boolean;
  questions: string[];
  reason: string;
}

interface OrchestrationStep {
  agent: string;
  status: 'ok' | 'error' | 'skipped';
  output: unknown;
  error?: string;
}

export interface OrchestrationResult {
  mode: 'fixed';
  status: 'clarification_needed' | 'completed' | 'failed';
  clarificationQuestions?: string[];
  usedAgents: string[];
  fallback?: 'manual_review';
  steps: OrchestrationStep[];
  report?: string;
}

// ---------------------------------------------------------------
// 编排服务
// ---------------------------------------------------------------

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  /**
   * 固定编排流程（已迁移至 LangGraph）：
   *
   *   extract → clarify → analysis → risk → summary
   *
   * - 需要澄清时：返回 clarificationQuestions 并终止
   * - 失败时：返回 fallback: 'manual_review'
   *
   * @param input            用户输入
   * @param retrievedContext  可选的检索增强上下文（来自语义检索或历史对话）
   * @param threadId          会话标识（传入相同值可在异常后断点恢复，不传则每次独立运行）
   */
  async orchestrate(
    input: string,
    retrievedContext?: string,
    threadId?: string,
  ): Promise<OrchestrationResult> {
    this.logger.log('[Graph] 启动需求分析图');
    const result = await runAnalysisGraph(input, retrievedContext, threadId);
    this.logger.log(`[Graph] 完成，状态: ${result.status}`);
    return result;
  }

  // ===============================================================
  // UI 协议转换（第 9.6 节）
  // ===============================================================

  /**
   * 将图执行结果转换为前端可渲染的 AIUIResponse。
   *
   * 动态逻辑：
   * - 从 result.activeExperts 动态生成 steps 组件的并行专家步骤
   * - 需要澄清时：渲染 UIConfirmation（HITL）
   * - 失败时：text 组件提示 + action_buttons 提供重试入口
   * - 完成后：text 报告 + steps 进度总结
   *
   * 向后兼容：
   * - activeExperts 为空时使用 steps[0].usedAgents 构造步骤（第 8 章兼容）
   */
  toUIResponse(result: GraphOrchestrationResult): AIUIResponse {
    const components: UIComponent[] = [];

    // ---------- 失败 ----------
    if (result.status === 'failed') {
      return {
        message: '需求分析执行失败，请重试或转人工处理。',
        components: [
          {
            type: 'text',
            content: `❌ 分析失败：${result.fallback ?? '未知错误'}`,
          },
          {
            type: 'action_buttons',
            actions: [
              { label: '重试', action: 'retry', style: 'primary' },
              { label: '转人工', action: 'manual_review', style: 'default' },
            ],
          },
        ],
        sessionStage: 'result',
        collectedData: { usedAgents: result.usedAgents },
      };
    }

    // ---------- 需要澄清（HITL）----------
    if (result.status === 'clarification_needed') {
      components.push({
        type: 'text',
        content: '⚠️ 需求信息不够清晰，需要你的补充说明。',
      });

      if (result.clarificationQuestions?.length) {
        components.push({
          type: 'confirmation',
          title: '需要澄清以下问题',
          summary: result.clarificationQuestions
            .map((q, i) => `${i + 1}. ${q}`)
            .join('\n'),
          confirmLabel: '我已补充',
          cancelLabel: '跳过澄清',
          riskLevel: 'low',
        });
      }

      return {
        message: '请确认或补充需求细节。',
        components,
        sessionStage: 'confirm',
        collectedData: {
          usedAgents: result.usedAgents,
          clarificationQuestions: result.clarificationQuestions,
        },
      };
    }

    // ---------- 完成 ----------
    const activeExperts = (result as any).activeExperts as string[] | undefined;

    // Steps: 从 activeExperts 动态生成并行专家步骤
    if (activeExperts && activeExperts.length > 0) {
      const expertLabels: Record<string, string> = {
        functional: '功能分析专家',
        performance: '性能分析专家',
        security: '安全分析专家',
        compliance: '合规分析专家',
      };

      const expertSteps: {
        label: string;
        description?: string;
        status: 'completed' | 'active' | 'pending';
      }[] = [];

      for (const expert of activeExperts) {
        expertSteps.push({
          label: `${expert}_expert`,
          description: expertLabels[expert] ?? expert,
          status: 'completed',
        });
      }

      // 加上汇总步骤
      expertSteps.push({
        label: 'aggregator',
        description: '汇总合并',
        status: 'completed',
      });

      components.push({
        type: 'steps',
        currentStep: activeExperts.length,
        steps: expertSteps,
      });
    } else {
      // 第 8 章兼容：使用 usedAgents 构造串行步骤
      const agents = result.usedAgents.filter(
        (a) =>
          a !== 'triage' &&
          a !== 'classifier' &&
          a !== 'queryHandler' &&
          a !== 'chatHandler',
      );

      components.push({
        type: 'steps',
        currentStep: agents.length,
        steps: agents.map((agent) => ({
          label: agent,
          status: 'completed' as const,
        })),
      });
    }

    // 报告摘要
    if (result.report) {
      const preview =
        result.report.length > 500
          ? result.report.substring(0, 500) + '...'
          : result.report;
      components.push({
        type: 'text',
        content: `✅ 分析完成\n\n${preview}`,
      });
    }

    // 操作按钮
    components.push({
      type: 'action_buttons',
      actions: [
        { label: '查看完整报告', action: 'view_report', style: 'primary' },
        { label: '导出 PDF', action: 'export_pdf', style: 'default' },
        { label: '新建分析', action: 'new_requirement', style: 'default' },
      ],
    });

    // 降级提示
    const degradedExperts = activeExperts
      ? this.extractDegradedExperts(result)
      : [];

    if (degradedExperts.length > 0) {
      components.push({
        type: 'text',
        content: `⚠️ 以下专家降级：${degradedExperts.join('、')}，相关维度建议人工补充。`,
      });
    }

    return {
      message: '需求分析已完成。',
      components,
      sessionStage: 'result',
      collectedData: {
        usedAgents: result.usedAgents,
        activeExperts: activeExperts ?? [],
        reportLength: result.report?.length ?? 0,
      },
    };
  }

  // ===============================================================
  // 内部工具
  // ===============================================================

  /**
   * 从 result.steps 的 analysisSupervisor 输出中提取降级专家列表。
   *
   * 遍历各 Analysis 字段查找 _degraded 标记。
   */
  private extractDegradedExperts(result: GraphOrchestrationResult): string[] {
    const degraded: string[] = [];
    const supervisorStep = result.steps.find(
      (s) => s.agent === 'analysisSupervisor' || s.agent === 'analysisSubgraph',
    );
    if (!supervisorStep?.output) return degraded;

    const output = supervisorStep.output as Record<string, unknown>;
    const expertFields = [
      'functionalAnalysis',
      'performanceAnalysis',
      'securityAnalysis',
      'complianceAnalysis',
    ];

    for (const field of expertFields) {
      const val = output[field] as Record<string, unknown> | undefined;
      if (val?._degraded) {
        degraded.push(field.replace('Analysis', ''));
      }
    }

    return degraded;
  }
}
