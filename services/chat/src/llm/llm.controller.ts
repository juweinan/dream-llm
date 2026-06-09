import { Body, Controller, Logger, Post } from '@nestjs/common';
import { LlmService } from './llm.service';

@Controller('api/langchain')
export class LlmController {
  private readonly logger = new Logger(LlmController.name);

  constructor(private readonly llmService: LlmService) {}

  @Post('invoke')
  async invoke(@Body() body: { input: string }) {
    try {
      return await this.llmService.invokeDemo(body.input);
    } catch (err) {
      this.logger.error('invokeDemo failed', err);
      throw err;
    }
  }

  @Post('stream')
  stream() {
    return this.llmService.stream();
  }

  @Post('batch')
  batch(@Body() body: { input?: string; count?: number } = {}) {
    return this.llmService.batch(body.count);
  }
}
