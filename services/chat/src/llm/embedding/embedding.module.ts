import { Module } from '@nestjs/common';
import { EmbeddingController } from './embedding.controller';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';

@Module({
  controllers: [EmbeddingController],
  providers: [EmbeddingService, VectorStoreService],
  exports: [EmbeddingService, VectorStoreService],
})
export class EmbeddingModule {}
