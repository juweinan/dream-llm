import { Injectable, Logger } from '@nestjs/common';
import { OrchestratorService } from './agents/orchestrator.service';
import { RunnableMemoryService } from './memory/runnable-memory.service';
import { VectorStoreService } from './embedding/vector-store.service';
import { FilesystemService } from './filesystem/filesystem.service';

// ---------------------------------------------------------------
// 类型
// ---------------------------------------------------------------

export interface AdvancedAnalysisResult {
  sessionId: string;
  status: 'clarification_needed' | 'completed' | 'failed';
  clarificationQuestions?: string[];
  usedAgents: string[];
  fallback?: 'manual_review';
  reportPath?: string;
  report?: string;
  memoryUpdated?: boolean;
}

// ---------------------------------------------------------------
// 统一分析服务
// ---------------------------------------------------------------

/**
 * 高级分析服务：串联多 Agent 编排 → 报告落盘 → 记忆写回 →
 * 相关规范灌入向量库，形成完整的分析闭环。
 */
@Injectable()
export class AdvancedAnalysisService {
  private readonly logger = new Logger(AdvancedAnalysisService.name);

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly memory: RunnableMemoryService,
    private readonly vectorStore: VectorStoreService,
    private readonly filesystem: FilesystemService,
  ) {}

  /**
   * 统一分析入口：
   *
   *   1. 从 session 历史中提取多轮上下文，增强 input
   *   2. 调用 OrchestratorService 执行多 Agent 分析
   *   3. 需要澄清 → 直接返回澄清问题（不落盘）
   *   4. 不需要澄清 → 将报告写入 workspace/reports/
   *   5. 把报告摘要提取为片段灌入向量库
   *   6. 用 appendMessage() 写回会话记忆
   *   7. 返回完整分析报告
   */
  async analyze(
    sessionId: string,
    input: string,
  ): Promise<AdvancedAnalysisResult> {
    const normalizedInput = input.trim();
    if (!normalizedInput) {
      return {
        sessionId,
        status: 'failed',
        usedAgents: [],
        fallback: 'manual_review',
      };
    }

    this.logger.log(`[analyze] sessionId=${sessionId} start`);

    try {
      // -----------------------------------------------------------
      // Step 0: 从 Memory 中读取历史上下文，拼接到 input 末尾
      // -----------------------------------------------------------
      const history = await this.memory.getHistory(sessionId);
      const enhancedInput =
        history.length > 0
          ? `${normalizedInput}\n\n[多轮对话历史上下文]\n${history
              .map((msg) => `[${msg.getType()}]: ${msg.content}`)
              .join('\n')}`
          : normalizedInput;

      // -----------------------------------------------------------
      // Step 1: Multi-Agent 编排分析
      // -----------------------------------------------------------
      const orchestration = await this.orchestrator.orchestrate(enhancedInput);

      // -----------------------------------------------------------
      // Step 2: 需要澄清 → 直接返回
      // -----------------------------------------------------------
      if (orchestration.status === 'clarification_needed') {
        await this.memory.appendMessage(
          sessionId,
          normalizedInput,
          `[澄清请求] ${orchestration.clarificationQuestions?.join('；')}`,
        );

        return {
          sessionId,
          status: 'clarification_needed',
          clarificationQuestions: orchestration.clarificationQuestions,
          usedAgents: orchestration.usedAgents,
          memoryUpdated: true,
        };
      }

      // -----------------------------------------------------------
      // Step 3: 失败 → 返回 fallback
      // -----------------------------------------------------------
      if (orchestration.status === 'failed' || !orchestration.report) {
        return {
          sessionId,
          status: 'failed',
          usedAgents: orchestration.usedAgents,
          fallback: 'manual_review',
        };
      }

      // -----------------------------------------------------------
      // Step 4: 将报告写入 workspace/reports/（委托 FilesystemService）
      // -----------------------------------------------------------
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const reportFileName = `reports/analysis-${safeSessionId}-${timestamp}.md`;

      this.filesystem.writeReport(reportFileName, orchestration.report);
      this.logger.log(`Report written: ${reportFileName}`);

      // -----------------------------------------------------------
      // Step 5: 把报告摘要灌入向量库（供后续语义检索）
      // -----------------------------------------------------------
      await this.indexReportToVector(orchestration.report);

      // -----------------------------------------------------------
      // Step 6: 用 appendMessage() 写回会话记忆
      // -----------------------------------------------------------
      await this.memory.appendMessage(
        sessionId,
        normalizedInput,
        `[分析报告已生成] ${reportFileName}\n\n分析摘要：${orchestration.report.slice(0, 300)}...`,
      );

      // -----------------------------------------------------------
      // Step 7: 返回完整结果
      // -----------------------------------------------------------
      return {
        sessionId,
        status: 'completed',
        usedAgents: orchestration.usedAgents,
        reportPath: reportFileName,
        report: orchestration.report,
        memoryUpdated: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`analyze failed: ${message}`);

      return {
        sessionId,
        status: 'failed',
        usedAgents: [],
        fallback: 'manual_review',
      };
    }
  }

  // ---------------------------------------------------------------
  // 私有：将报告内容拆段灌入向量库
  // ---------------------------------------------------------------
  private async indexReportToVector(report: string): Promise<void> {
    try {
      // 按 Markdown 二级标题分段
      const sections = report
        .split(/^## /m)
        .map((s) => s.trim())
        .filter((s) => s.length > 50);

      if (sections.length > 0) {
        await this.vectorStore.addTexts(sections);
        this.logger.log(
          `Indexed ${sections.length} report sections to vector store`,
        );
      }
    } catch (err) {
      // 灌库失败不阻塞主流程
      this.logger.warn(
        `Index to vector store failed (non-blocking): ${(err as Error).message}`,
      );
    }
  }
}
