import { Body, Controller, Logger, Post } from '@nestjs/common';
import { AdvancedAnalysisService } from './advanced-analysis.service';

@Controller('api/advanced')
export class AdvancedController {
  private readonly logger = new Logger(AdvancedController.name);

  constructor(private readonly advancedAnalysis: AdvancedAnalysisService) {}

  /**
   * POST /api/advanced/analyze
   * Body: { sessionId: string, input: string }
   *
   * 统一分析入口：
   *   Memory 历史上下文增强
   *   → Multi-Agent 编排分析
   *   → 报告落盘 + 向量灌库 + 记忆写回
   */
  @Post('analyze')
  async analyze(@Body() body: { sessionId?: string; input?: string } = {}) {
    try {
      const { sessionId, input } = body;

      if (!sessionId?.trim() || !input?.trim()) {
        return { ok: false, error: 'sessionId 和 input 不能为空' };
      }

      return {
        ok: true,
        result: await this.advancedAnalysis.analyze(sessionId, input),
      };
    } catch (err) {
      this.logger.error('analyze failed', err);
      throw err;
    }
  }
}
