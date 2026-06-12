import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LlmModule } from './llm/llm.module';
import { MemoryModule } from './llm/memory/memory.module';
import { FilesystemModule } from './llm/filesystem/filesystem.module';
import { EmbeddingModule } from './llm/embedding/embedding.module';
import { AgentsModule } from './llm/agents/agents.module';

@Module({
  imports: [
    LlmModule,
    MemoryModule,
    FilesystemModule,
    EmbeddingModule,
    AgentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
