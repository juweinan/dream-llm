import { Module } from "@nestjs/common";
import { EmbeddingModule } from "../llm/embedding/embedding.module";
import { SseModule } from "../sse/sse.module";
import { DocumentController } from "./document.controller";
import { SearchController } from "./search.controller";
import { DocumentService } from "./document.service";
import { ChunkService } from "./chunk.service";
import { SearchService } from "./search.service";

@Module({
  imports: [EmbeddingModule, SseModule],
  controllers: [DocumentController, SearchController],
  providers: [DocumentService, ChunkService, SearchService],
  exports: [SearchService],
})
export class DocumentModule {}
