import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Response } from 'express';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface TaskEventPayload {
  taskId: string;
  taskType: string;
  status: TaskStatus;
  message?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class SseService {
  private readonly logger = new Logger(SseService.name);
  /** userId → 该用户的活跃 SSE 连接集合（一个用户可能开多个 Tab） */
  private readonly connections = new Map<string, Set<Response>>();

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------
  // 连接管理
  // ---------------------------------------------------------------

  addConnection(userId: string, res: Response) {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId)!.add(res);
    this.logger.log(
      `SSE connected: userId=${userId} (total connections: ${this.connections.get(userId)!.size})`,
    );
  }

  removeConnection(userId: string, res: Response) {
    const set = this.connections.get(userId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) {
      this.connections.delete(userId);
    }
    this.logger.log(`SSE disconnected: userId=${userId}`);
  }

  // ---------------------------------------------------------------
  // 事件推送
  // ---------------------------------------------------------------

  /**
   * 持久化事件到 task_events 表，并实时推送给所有在线连接。
   */
  async emit(userId: string, payload: TaskEventPayload) {
    // 1. 持久化
    const event = await this.prisma.taskEvent.create({
      data: {
        userId,
        taskType: payload.taskType,
        taskId: payload.taskId,
        status: payload.status,
        message: payload.message,
        metadata: (payload.metadata ?? undefined) as any,
      },
    });

    // 2. 实时推送
    const data = JSON.stringify({
      id: event.id,
      taskType: event.taskType,
      taskId: event.taskId,
      status: event.status,
      message: event.message,
      metadata: event.metadata,
      createdAt: event.createdAt,
    });

    const connections = this.connections.get(userId);
    if (connections) {
      for (const res of connections) {
        try {
          res.write(`data: ${data}\n\n`);
        } catch {
          this.removeConnection(userId, res);
        }
      }
    }

    return event;
  }

  // ---------------------------------------------------------------
  // 定时清理（每 30 分钟）
  // ---------------------------------------------------------------

  @Cron('0 */30 * * * *')
  async handleCronCleanup() {
    this.logger.log('Running SSE cleanup...');

    // 1. 清理无响应的连接（已断连但未被 removeConnection 捕获的）
    for (const [userId, set] of this.connections.entries()) {
      for (const res of set) {
        if (res.destroyed) {
          set.delete(res);
        }
      }
      if (set.size === 0) {
        this.connections.delete(userId);
      }
    }

    // 2. 删除 30 天前的 task_events
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.taskEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} old task events`);
    }
  }
}
