import { Body, Controller, Get, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { RequirementService } from './llm/requirement.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly requirementService: RequirementService,
  ) {}

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('hello')
  getHello() {
    return this.appService.getHello();
  }

  @Post('requirement/extract')
  async extract(@Body() body: { input?: string } = {}) {
    return this.requirementService.extract(body.input ?? '');
  }
}
