import { Module } from '@nestjs/common';
import { MemoryModule } from './memory/memory.module';
import { FilesystemModule } from './filesystem/filesystem.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { AgentsModule } from './agents/agents.module';
import { AdvancedAnalysisService } from './advanced-analysis.service';
import { AdvancedController } from './advanced.controller';

/**
 * 高级整合模块 — 收拢第四章节所有能力：
 * - Memory（多轮对话记忆）
 * - Filesystem（文件系统工具）
 * - Embedding（向量嵌入 + 向量存储）
 * - Agents（多 Agent 固定编排）
 * - Advanced（统一分析入口）
 */
@Module({
  imports: [MemoryModule, FilesystemModule, EmbeddingModule, AgentsModule],
  providers: [AdvancedAnalysisService],
  controllers: [AdvancedController],
  exports: [AdvancedAnalysisService],
})
export class AdvancedModule {}
