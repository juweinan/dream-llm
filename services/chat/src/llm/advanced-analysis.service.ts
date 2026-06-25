import { Injectable, Logger } from '@nestjs/common';
import { OrchestratorService } from './agents/orchestrator.service';
import { MessageService } from '../message/message.service';
import { SearchService } from '../document/search.service';

// ---------------------------------------------------------------
// 类型
// ---------------------------------------------------------------

export interface AdvancedAnalysisResult {
  status: 'clarification_needed' | 'completed' | 'failed';
  clarificationQuestions?: string[];
  usedAgents: string[];
  fallback?: 'manual_review';
  report?: string;
  retrievedDocuments: Array<{
    content: string;
    score: number;
    documentId: string;
    filename: string;
  }>;
}

// ---------------------------------------------------------------
// 统一分析服务
// ---------------------------------------------------------------

/**
 * 统一分析入口 — 串联多能力：
 *
 *   1. DbChatHistory → 多轮对话历史
 *   2. SearchService → 语义检索用户文档（topK=3）
 *   3. 拼接历史 + 检索上下文 + 当前输入
 *   4. OrchestratorService → 多 Agent 编排分析
 *   5. 用户输入 + 分析结论写入 messages 表
 *   6. 返回 report / usedAgents / retrievedDocuments
 */
@Injectable()
export class AdvancedAnalysisService {
  private readonly logger = new Logger(AdvancedAnalysisService.name);

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly messageService: MessageService,
    private readonly searchService: SearchService,
  ) {}

  async analyze(
    userId: string,
    conversationId: string,
    input: string,
  ): Promise<AdvancedAnalysisResult> {
    const normalizedInput = input.trim();
    if (!normalizedInput) {
      return {
        status: 'failed',
        usedAgents: [],
        fallback: 'manual_review',
        retrievedDocuments: [],
      };
    }

    this.logger.log(
      `[analyze] userId=${userId}, conversationId=${conversationId}`,
    );

    try {
      // -----------------------------------------------------------
      // Step 1: 从 messages 表读取历史对话，转为上下文文本
      // -----------------------------------------------------------
      const historyMessages =
        await this.messageService.getHistoryAsLangChainMessages(conversationId);
      const historyContext =
        historyMessages.length > 0
          ? historyMessages
              .map((msg) => `[${msg.getType()}]: ${msg.content}`)
              .join('\n')
          : '';

      // -----------------------------------------------------------
      // Step 2: 语义检索当前用户文档（topK=3）
      // -----------------------------------------------------------
      let retrievedDocuments: Array<{
        content: string;
        score: number;
        documentId: string;
        filename: string;
      }> = [];

      let retrievedContext = '';

      try {
        retrievedDocuments = await this.searchService.similaritySearch(
          normalizedInput,
          userId,
          3,
        );
        if (retrievedDocuments.length > 0) {
          retrievedContext = retrievedDocuments
            .map((doc, i) => `[文档${i + 1}: ${doc.filename}]\n${doc.content}`)
            .join('\n\n');
        }
      } catch (err) {
        // 检索失败不阻塞主流程（用户可能还没有上传文档）
        this.logger.warn(`Semantic search skipped: ${(err as Error).message}`);
      }

      // -----------------------------------------------------------
      // Step 3: 拼接完整上下文（历史 + 检索上下文）
      // -----------------------------------------------------------
      const contextParts: string[] = [];
      if (historyContext) {
        contextParts.push(`[多轮对话历史]\n${historyContext}`);
      }
      if (retrievedContext) {
        contextParts.push(`[相关文档]\n${retrievedContext}`);
      }
      const fullContext = contextParts.join('\n\n');

      // -----------------------------------------------------------
      // Step 4: 多 Agent 编排分析
      // -----------------------------------------------------------
      const orchestration = await this.orchestrator.orchestrate(
        normalizedInput,
        fullContext || undefined,
      );

      // -----------------------------------------------------------
      // Step 5: 写 messages 表（用户输入 always；分析结论 when available）
      // -----------------------------------------------------------
      await this.messageService.addMessage(
        conversationId,
        'USER',
        normalizedInput,
      );

      if (orchestration.status === 'clarification_needed') {
        const questions =
          orchestration.clarificationQuestions?.join('；') || '';
        await this.messageService.addMessage(
          conversationId,
          'ASSISTANT',
          `[需要澄清] ${questions}`,
        );

        return {
          status: 'clarification_needed',
          clarificationQuestions: orchestration.clarificationQuestions,
          usedAgents: orchestration.usedAgents,
          retrievedDocuments,
        };
      }

      if (orchestration.status === 'failed' || !orchestration.report) {
        return {
          status: 'failed',
          usedAgents: orchestration.usedAgents,
          fallback: 'manual_review',
          retrievedDocuments,
        };
      }

      // 分析完成：写分析结论到 ASSISTANT 消息
      await this.messageService.addMessage(
        conversationId,
        'ASSISTANT',
        orchestration.report,
      );

      // -----------------------------------------------------------
      // Step 6: 返回
      // -----------------------------------------------------------
      this.logger.log(
        `[analyze] completed: usedAgents=${orchestration.usedAgents.join(', ')}`,
      );

      return {
        status: 'completed',
        usedAgents: orchestration.usedAgents,
        report: orchestration.report,
        retrievedDocuments,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`analyze failed: ${message}`);

      // 失败时至少保存用户消息
      try {
        await this.messageService.addMessage(
          conversationId,
          'USER',
          normalizedInput,
        );
      } catch {}

      return {
        status: 'failed',
        usedAgents: [],
        fallback: 'manual_review',
        retrievedDocuments: [],
      };
    }
  }
}
