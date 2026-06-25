import { Controller, Get, Logger, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../common/guards/auth.guard';
import { SseService } from './sse.service';

@Controller('api/sse')
export class SseController {
  private readonly logger = new Logger(SseController.name);

  constructor(private readonly sseService: SseService) {}

  private getUserId(req: Request): string {
    return (req as any).user.sub as string;
  }

  /**
   * GET /api/sse/tasks
   * SSE 事件流：注册连接 + 心跳，断开时自动清理。
   */
  @Get('tasks')
  @UseGuards(AuthGuard)
  async streamTasks(@Req() req: Request, @Res() res: Response) {
    const userId = this.getUserId(req);

    // SSE 协议头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // 禁用 nginx 缓冲
    });

    // 发送初始连接确认
    res.write(`data: ${JSON.stringify({ type: 'connected', userId })}\n\n`);

    // 注册连接
    this.sseService.addConnection(userId, res);

    // 心跳（每 30 秒），防止反向代理断开空闲连接
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 30_000);

    // 客户端断开时清理
    req.on('close', () => {
      clearInterval(heartbeat);
      this.sseService.removeConnection(userId, res);
    });

    // 保持连接打开（不调用 res.end）
  }
}
