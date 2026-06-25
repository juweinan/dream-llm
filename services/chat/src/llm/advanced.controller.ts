import { Body, Controller, Logger, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../common/guards/auth.guard';
import { AdvancedAnalysisService } from './advanced-analysis.service';

@Controller('api/advanced')
export class AdvancedController {
  private readonly logger = new Logger(AdvancedController.name);

  constructor(private readonly advancedAnalysis: AdvancedAnalysisService) {}

  private getUserId(req: Request): string {
    return (req as any).user.sub as string;
  }

  /**
   * POST /api/advanced/analyze
   * Body: { conversationId: string, input: string }
   *
   * 统一分析入口：
   *   历史 + 语义检索 + 多 Agent 编排 → 写 messages 表
   */
  @Post('analyze')
  @UseGuards(AuthGuard)
  async analyze(
    @Req() req: Request,
    @Body() body: { conversationId?: string; input?: string } = {},
  ) {
    try {
      const userId = this.getUserId(req);
      const { conversationId, input } = body;

      if (!conversationId?.trim() || !input?.trim()) {
        return { ok: false, error: 'conversationId 和 input 不能为空' };
      }

      return {
        ok: true,
        result: await this.advancedAnalysis.analyze(
          userId,
          conversationId,
          input,
        ),
      };
    } catch (err) {
      this.logger.error('analyze failed', err);
      throw err;
    }
  }
}
