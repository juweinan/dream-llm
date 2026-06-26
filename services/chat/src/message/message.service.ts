import { Injectable } from '@nestjs/common';
import { MessageRole } from '../prisma/generated';
import {
  HumanMessage,
  AIMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MessageService {
  constructor(private readonly prisma: PrismaService) {}

  async addMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.prisma.message.create({
      data: {
        conversationId,
        role,
        content,
        metadata: (metadata ?? undefined) as any,
      },
    });
  }

  async getHistory(conversationId: string, limit?: number) {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /**
   * 将数据库消息转为 LangChain BaseMessage 数组，供 RunnableWithMessageHistory 使用
   */
  async getHistoryAsLangChainMessages(
    conversationId: string,
  ): Promise<BaseMessage[]> {
    const messages = await this.getHistory(conversationId);

    return messages.map((msg) => {
      if (msg.role === MessageRole.USER) {
        return new HumanMessage({
          content: msg.content,
        });
      }
      return new AIMessage({
        content: msg.content,
      });
    });
  }

  /**
   * 删除指定会话的全部消息
   */
  async clearMessages(conversationId: string): Promise<number> {
    const result = await this.prisma.message.deleteMany({
      where: { conversationId },
    });
    return result.count;
  }
}
