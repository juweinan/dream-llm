import { Injectable, Logger } from '@nestjs/common';
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import { Document } from '@langchain/core/documents';
import { EmbeddingService } from './embedding.service';

/**
 * 基于 MemoryVectorStore 的内存向量存储服务。
 * 无需外部向量数据库，向量和文档均保存在进程内存中。
 */
@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);
  private store: MemoryVectorStore | null = null;
  private initPromise: Promise<MemoryVectorStore> | null = null;

  constructor(private readonly embedding: EmbeddingService) {}

  /**
   * 延迟初始化：确保 MemoryVectorStore 只创建一次
   */
  private async ensureStore(): Promise<MemoryVectorStore> {
    if (this.store) return this.store;

    if (!this.initPromise) {
      this.logger.log('Initializing MemoryVectorStore ...');
      this.initPromise = MemoryVectorStore.fromExistingIndex(
        this.embedding,
      ).then((store) => {
        this.logger.log('MemoryVectorStore initialized');
        this.store = store;
        return store;
      });
    }

    return this.initPromise;
  }

  /**
   * 批量添加文本到向量库
   * @param texts 文本数组
   * @returns 添加的文档数
   */
  async addTexts(texts: string[]): Promise<{ added: number }> {
    const store = await this.ensureStore();

    const docs = texts.map((text) => new Document({ pageContent: text }));
    await store.addDocuments(docs);

    this.logger.log(`Added ${docs.length} documents to vector store`);
    return { added: docs.length };
  }

  /**
   * 语义搜索：返回最相似的 k 个文档
   * @param query 查询文本
   * @param k 返回条数，默认 3
   * @returns 相似文档数组，包含内容与相似度分数
   */
  async search(
    query: string,
    k = 3,
  ): Promise<{
    query: string;
    results: Array<{ content: string; score: number }>;
  }> {
    const store = await this.ensureStore();

    // 先获取所有内存向量进行手动相似度搜索（带分数）
    const queryEmbedding = await this.embedding.embedQuery(query);
    const resultsWithScore = await store.similaritySearchVectorWithScore(
      queryEmbedding,
      k,
    );

    return {
      query,
      results: resultsWithScore.map(([doc, score]) => ({
        content: doc.pageContent,
        score,
      })),
    };
  }

  /**
   * 获取当前存储的文档总数
   */
  async count(): Promise<number> {
    const store = await this.ensureStore();
    return store.memoryVectors.length;
  }
}
