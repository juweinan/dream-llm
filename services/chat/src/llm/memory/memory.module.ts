import { Module } from '@nestjs/common';
import { MemoryController } from './memory.controller';
import { RunnableMemoryService } from './runnable-memory.service';

@Module({
  controllers: [MemoryController],
  providers: [RunnableMemoryService],
  exports: [RunnableMemoryService],
})
export class MemoryModule {}
