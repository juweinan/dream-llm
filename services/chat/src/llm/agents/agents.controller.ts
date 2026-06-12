import { Body, Controller, Logger, Post } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';

@Controller('api/agents')
export class AgentsController {
  private readonly logger = new Logger(AgentsController.name);

  constructor(private readonly orchestrator: OrchestratorService) {}

  /**
   * POST /api/agents/orchestrate
   * Body: { input: string }
   *
   * 执行多 Agent 固定编排：extract → clarify → parallel(analysis + risk) → summary
   */
  @Post('orchestrate')
  async orchestrate(@Body() body: { input?: string } = {}) {
    try {
      return await this.orchestrator.orchestrate(body.input ?? '');
    } catch (err) {
      this.logger.error('orchestrate failed', err);
      throw err;
    }
  }
}
