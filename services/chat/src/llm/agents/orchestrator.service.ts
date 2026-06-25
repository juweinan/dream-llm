import { Injectable, Logger } from '@nestjs/common';
import {
  extractAgent,
  clarifyAgent,
  analysisAgent,
  riskAgent,
  summaryAgent,
} from './sub-agents';

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
   * 固定编排流程：
   *
   *   extract → clarify → [analysis ∥ risk] → summary
   *
   * - 需要澄清时：返回 clarificationQuestions 并终止
   * - 失败时：返回 fallback: 'manual_review'
   *
   * @param input 用户输入
   * @param retrievedContext 可选的检索增强上下文（来自语义检索或历史对话）
   */
  async orchestrate(input: string, retrievedContext?: string): Promise<OrchestrationResult> {
    const normalizedInput = input.trim();
    const contextPart = retrievedContext?.trim();

    // 将检索上下文拼接到输入中
    const fullInput = contextPart
      ? `${normalizedInput}\n\n[参考上下文]\n${contextPart}`
      : normalizedInput;

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

    const steps: OrchestrationStep[] = [];
    const usedAgents: string[] = [];

    try {
      // -----------------------------------------------------------
      // Step 1: 抽取（extract）
      // -----------------------------------------------------------
      this.logger.log('[Step 1] extractAgent');
      const extractRaw = await extractAgent.invoke({ input: fullInput });
      const extracted = this.safeParseJSON<ExtractResult>(extractRaw);

      usedAgents.push('extract');
      steps.push({ agent: 'extract', status: 'ok', output: extracted });

      // -----------------------------------------------------------
      // Step 2: 澄清判断（clarify）
      // -----------------------------------------------------------
      this.logger.log('[Step 2] clarifyAgent');
      const clarifyRaw = await clarifyAgent.invoke({
        input: fullInput,
        extracted: JSON.stringify(extracted, null, 2),
      });
      const clarification = this.safeParseJSON<ClarifyResult>(clarifyRaw);

      usedAgents.push('clarify');
      steps.push({ agent: 'clarify', status: 'ok', output: clarification });

      // 需要澄清 → 终止流程，返回问题列表
      if (
        clarification.needsClarification &&
        clarification.questions.length > 0
      ) {
        this.logger.log(
          `[Clarify] 需要澄清，问题数: ${clarification.questions.length}`,
        );
        return {
          mode: 'fixed',
          status: 'clarification_needed',
          clarificationQuestions: clarification.questions,
          usedAgents,
          steps,
        };
      }

      // -----------------------------------------------------------
      // Step 3: 并行（analysis ∥ risk）
      // -----------------------------------------------------------
      this.logger.log('[Step 3] analysisAgent ∥ riskAgent');

      const clarificationStr = JSON.stringify(clarification);
      const extractedStr = JSON.stringify(extracted);

      const [analysisRaw, riskRaw] = await Promise.all([
        analysisAgent.invoke({
          input: fullInput,
          extracted: extractedStr,
          clarification: clarificationStr,
        }),
        riskAgent.invoke({
          input: fullInput,
          extracted: extractedStr,
        }),
      ]);

      const analysis = this.safeParseJSON(analysisRaw);
      const risk = this.safeParseJSON(riskRaw);

      usedAgents.push('analysis', 'risk');
      steps.push({ agent: 'analysis', status: 'ok', output: analysis });
      steps.push({ agent: 'risk', status: 'ok', output: risk });

      // -----------------------------------------------------------
      // Step 4: 汇总（summary）
      // -----------------------------------------------------------
      this.logger.log('[Step 4] summaryAgent');
      const summaryRaw = await summaryAgent.invoke({
        input: fullInput,
        extracted: extractedStr,
        clarification: clarificationStr,
        analysis: JSON.stringify(analysis, null, 2),
        risk: JSON.stringify(risk, null, 2),
      });

      usedAgents.push('summary');
      steps.push({
        agent: 'summary',
        status: 'ok',
        output: summaryRaw,
      });

      this.logger.log('[Done] 编排完成');

      return {
        mode: 'fixed',
        status: 'completed',
        usedAgents,
        steps,
        report: summaryRaw,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `编排失败: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );

      return {
        mode: 'fixed',
        status: 'failed',
        usedAgents,
        fallback: 'manual_review',
        steps,
      };
    }
  }

  // ---------------------------------------------------------------
  // 安全 JSON 解析
  // ---------------------------------------------------------------
  private safeParseJSON<T = unknown>(raw: string): T {
    try {
      // 尝试从模型输出中提取 JSON（处理可能的 markdown 代码块包裹）
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();
      return JSON.parse(jsonStr) as T;
    } catch {
      // 解析失败时返回原始字符串作为兜底
      return { parseError: true, raw } as unknown as T;
    }
  }
}
