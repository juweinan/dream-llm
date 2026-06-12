import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { OrchestratorService } from './orchestrator.service';

@Module({
  controllers: [AgentsController],
  providers: [OrchestratorService],
  exports: [OrchestratorService],
})
export class AgentsModule {}
