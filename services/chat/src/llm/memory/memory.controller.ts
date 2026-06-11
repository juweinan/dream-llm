import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { RunnableMemoryService } from './runnable-memory.service';

@Controller('api/memory')
export class MemoryController {
  private readonly logger = new Logger(MemoryController.name);

  constructor(private readonly memoryService: RunnableMemoryService) {}

  /**
   * POST /api/memory/chat
   * Body: { sessionId: string, input: string }
   *
   * 多轮对话（trimMessages 裁剪版，maxTokens: 2000）
   */
  @Post('chat')
  async chat(@Body() body: { sessionId: string; input: string }) {
    const { sessionId, input } = body;

    if (!sessionId || !input?.trim()) {
      return {
        ok: false,
        error: 'sessionId 和 input 不能为空',
      };
    }

    try {
      const content = await this.memoryService.chatTrimmed(sessionId, input);
      return { ok: true, sessionId, content };
    } catch (err) {
      this.logger.error('chat failed', err);
      throw err;
    }
  }

  /**
   * POST /api/memory/chat-basic
   * Body: { sessionId: string, input: string }
   *
   * 多轮对话（基础版，保留全部历史，不裁剪）
   */
  @Post('chat-basic')
  async chatBasic(@Body() body: { sessionId: string; input: string }) {
    const { sessionId, input } = body;

    if (!sessionId || !input?.trim()) {
      return {
        ok: false,
        error: 'sessionId 和 input 不能为空',
      };
    }

    try {
      const content = await this.memoryService.chat(sessionId, input);
      return { ok: true, sessionId, content };
    } catch (err) {
      this.logger.error('chatBasic failed', err);
      throw err;
    }
  }

  /**
   * GET /api/memory/history/:sessionId
   *
   * 返回当前会话的历史消息
   */
  @Get('history/:sessionId')
  async getHistory(@Param('sessionId') sessionId: string) {
    try {
      const messages = await this.memoryService.getHistory(sessionId);
      return {
        ok: true,
        sessionId,
        count: messages.length,
        messages: messages.map((msg) => ({
          type: msg.getType(),
          content: msg.content,
        })),
      };
    } catch (err) {
      this.logger.error('getHistory failed', err);
      throw err;
    }
  }

  /**
   * DELETE /api/memory/history/:sessionId
   *
   * 清除指定会话的记忆
   */
  @Delete('history/:sessionId')
  async clearHistory(@Param('sessionId') sessionId: string) {
    try {
      await this.memoryService.clearSession(sessionId);
      return { ok: true, sessionId, message: '会话记忆已清除' };
    } catch (err) {
      this.logger.error('clearHistory failed', err);
      throw err;
    }
  }
}
