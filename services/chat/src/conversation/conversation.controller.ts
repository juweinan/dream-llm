import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../common/guards/auth.guard';
import { ConversationService } from './conversation.service';
import { MessageService } from '../message/message.service';
import { AdvancedAnalysisService } from '../llm/advanced-analysis.service';
import { runAnalysisGraphStream } from '../llm/graph/requirement-analysis-graph';

@Controller('api/conversations')
@UseGuards(AuthGuard)
export class ConversationController {
  private readonly logger = new Logger(ConversationController.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly analysisService: AdvancedAnalysisService,
  ) {}

  private getUserId(req: Request): string {
    return (req as any).user.sub as string;
  }

  /**
   * POST /api/conversations
   * Body: { title?: string }
   */
  @Post()
  async create(@Req() req: Request, @Body() body: { title?: string }) {
    const userId = this.getUserId(req);
    const conversation = await this.conversationService.create(
      userId,
      body.title,
    );
    return { ok: true, conversation };
  }

  /**
   * GET /api/conversations
   */
  @Get()
  async list(@Req() req: Request) {
    const userId = this.getUserId(req);
    const conversations = await this.conversationService.findByUser(userId);
    return { ok: true, conversations };
  }

  /**
   * GET /api/conversations/:id/messages
   */
  @Get(':id/messages')
  async getMessages(@Req() req: Request, @Param('id') id: string) {
    const userId = this.getUserId(req);
    await this.conversationService.findById(id, userId);

    const messages = await this.messageService.getHistory(id);
    return {
      ok: true,
      conversationId: id,
      count: messages.length,
      messages: messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata,
        createdAt: msg.createdAt,
      })),
    };
  }

  /**
   * POST /api/conversations/:id/chat
   * Body: { input: string }
   *
   * 统一分析入口：历史 + 语义检索 + 多 Agent 编排 → 写 messages 表
   */
  @Post(':id/chat')
  async chat(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { input: string },
  ) {
    const userId = this.getUserId(req);
    const input = body.input?.trim();
    if (!input) {
      return { ok: false, error: 'input 不能为空' };
    }

    await this.conversationService.findById(id, userId);

    const result = await this.analysisService.analyze(userId, id, input);

    return {
      ok: true,
      conversationId: id,
      ...result,
    };
  }

  /**
   * POST /api/conversations/:id/chat/stream
   * Body: { input: string }
   *
   * 流式分析入口：SSE 逐节点推送进度。
   * 与 POST :id/chat 共享同一个图结构，仅将 invoke 替换为 stream。
   */
  @Post(':id/chat/stream')
  async chatStream(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { input: string },
    @Res() res: Response,
  ) {
    const userId = this.getUserId(req);
    const input = body.input?.trim();
    if (!input) {
      res.status(400).json({ ok: false, error: 'input 不能为空' });
      return;
    }

    // 验证会话所有权
    try {
      await this.conversationService.findById(id, userId);
    } catch {
      res.status(404).json({ ok: false, error: '会话不存在或无权访问' });
      return;
    }

    // 保存用户消息落库
    await this.messageService.addMessage(id, 'USER', input);

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // 逐节点推送进度
    for await (const event of runAnalysisGraphStream(input)) {
      const sseLine = `data: ${JSON.stringify(event)}\n\n`;
      res.write(sseLine);

      // done 事件时将 ASSISTANT 报告写入 messages 表
      if (event.type === 'done' && event.result?.report) {
        await this.messageService.addMessage(
          id,
          'ASSISTANT',
          event.result.report,
        );
      } else if (event.type === 'done' && event.result?.queryResponse) {
        await this.messageService.addMessage(
          id,
          'ASSISTANT',
          event.result.queryResponse,
        );
      } else if (event.type === 'done' && event.result?.chatResponse) {
        await this.messageService.addMessage(
          id,
          'ASSISTANT',
          event.result.chatResponse,
        );
      }
    }

    res.end();
  }

  /**
   * DELETE /api/conversations/:id
   */
  @Delete(':id')
  async delete(@Req() req: Request, @Param('id') id: string) {
    const userId = this.getUserId(req);
    await this.conversationService.delete(id, userId);
    return { ok: true, message: '会话已删除' };
  }
}
