import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../common/guards/auth.guard';
import { ConversationService } from './conversation.service';
import { MessageService } from '../message/message.service';
import { DbChatMessageHistory } from '../message/db-chat-history';
import { createChatModel } from '../llm/model.factory';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import { RunnableWithMessageHistory } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';

const CHAT_SYSTEM_PROMPT = `你是一名智能助手。你可以基于多轮对话的上下文理解用户意图，并给出专业、连贯的回答。

要求：
1. 记住并引用之前讨论过的内容
2. 回答保持专业、清晰的中文表达
3. 如果用户的问题不够明确，基于历史记录推断并友好地追问`;

@Controller('api/conversations')
@UseGuards(AuthGuard)
export class ConversationController {
  private readonly logger = new Logger(ConversationController.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
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

    const model = createChatModel();
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', CHAT_SYSTEM_PROMPT],
      new MessagesPlaceholder('history'),
      ['human', '{input}'],
    ]);

    const chain = prompt.pipe(model).pipe(new StringOutputParser());

    const withHistory = new RunnableWithMessageHistory({
      runnable: chain,
      getMessageHistory: (_sessionId) =>
        new DbChatMessageHistory(id, this.messageService),
      inputMessagesKey: 'input',
      historyMessagesKey: 'history',
    });

    const response = await withHistory.invoke(
      { input },
      { configurable: { sessionId: id } },
    );

    return { ok: true, conversationId: id, content: response };
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
