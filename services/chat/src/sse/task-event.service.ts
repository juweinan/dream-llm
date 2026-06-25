import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class TaskEventService {
  constructor(private readonly prisma: PrismaService) {}

  async getHistory(userId: string, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.taskEvent.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      this.prisma.taskEvent.count({ where: { userId } }),
    ]);

    return { items, total, page, pageSize };
  }

  async findByTaskId(taskId: string, userId: string) {
    const event = await this.prisma.taskEvent.findFirst({
      where: { taskId, userId },
    });

    if (!event) {
      throw new NotFoundException("任务不存在");
    }

    return event;
  }

  async markRead(taskId: string, userId: string) {
    await this.findByTaskId(taskId, userId);
    return this.prisma.taskEvent.updateMany({
      where: { taskId, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
