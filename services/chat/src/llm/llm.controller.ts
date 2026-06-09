import { Body, Controller, Post } from '@nestjs/common';
import { LlmService } from './llm.service';

@Controller('api/langchain')
export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  @Post('invoke')
  invoke() {
    return this.llmService.invoke();
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
