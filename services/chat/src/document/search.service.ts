import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../llm/embedding/embedding.service';

export interface SearchResult {
  content: string;
  score: number;
  documentId: string;
  filename: string;
  chunkIndex: number;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  /**
   * 语义检索：query 向量化 → pgvector <=> 余弦距离 → 过滤 userId → 返回 topK
   *
   * @param query     用户输入的查询文本
   * @param userId    当前用户 ID（用于结果隔离）
   * @param topK      返回条数，默认 5
   */
  async similaritySearch(
    query: string,
    userId: string,
    topK = 5,
  ): Promise<SearchResult[]> {
    // 1. 查询文本 → 384 维向量
    const queryVector = await this.embedding.embedQuery(query);
    const vectorStr = `[${queryVector.join(',')}]`;

    // 2. pgvector <=> 余弦距离：值越小越相似
    //    通过 JOIN documents 限制当前用户的数据
    const raw: Array<{
      content: string;
      score: number;
      documentId: string;
      filename: string;
      chunkIndex: number;
    }> = await this.prisma.$queryRawUnsafe(
      `SELECT
        dc.content,
        dc.embedding <=> $1::vector AS score,
        dc."documentId",
        d.filename,
        dc."chunkIndex"
      FROM "DocumentChunk" dc
      JOIN "Document" d ON d.id = dc."documentId"
      WHERE d."userId" = $2
      ORDER BY score ASC
      LIMIT $3`,
      vectorStr,
      userId,
      topK,
    );

    return raw;
  }
}
