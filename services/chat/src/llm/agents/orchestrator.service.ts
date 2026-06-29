import { Injectable, Logger } from '@nestjs/common';
import { runAnalysisGraph } from '../graph/requirement-analysis-graph';

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
   * @param input 用户输入
   * @param retrievedContext 可选的检索增强上下文（来自语义检索或历史对话）
   */
  async orchestrate(
    input: string,
    retrievedContext?: string,
  ): Promise<OrchestrationResult> {
    this.logger.log('[Graph] 启动需求分析图');
    const result = await runAnalysisGraph(input, retrievedContext);
    this.logger.log(`[Graph] 完成，状态: ${result.status}`);
    return result;
  }
}
