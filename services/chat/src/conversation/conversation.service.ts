import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, title?: string) {
    return this.prisma.conversation.create({
      data: {
        userId,
        title: title || '新对话',
      },
    });
  }

  async findByUser(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findById(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException('会话不存在');
    }

    if (conversation.userId !== userId) {
      throw new NotFoundException('无权访问此会话');
    }

    return conversation;
  }

  async delete(conversationId: string, userId: string) {
    await this.findById(conversationId, userId);

    return this.prisma.conversation.delete({
      where: { id: conversationId },
    });
  }
}
