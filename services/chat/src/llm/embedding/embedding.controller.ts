import { Body, Controller, Logger, Post } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';

@Controller('api/embedding')
export class EmbeddingController {
  private readonly logger = new Logger(EmbeddingController.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStore: VectorStoreService,
  ) {}

  /**
   * POST /api/embedding/embed
   * Body: { text: string }
   *
   * 对单条文本进行向量化，返回向量维度与向量
   */
  @Post('embed')
  async embed(@Body() body: { text?: string } = {}) {
    try {
      const text = body.text?.trim();
      if (!text) {
        return { ok: false, error: 'text 不能为空' };
      }

      const vector = await this.embeddingService.embedQuery(text);
      return {
        ok: true,
        text,
        dimension: vector.length,
        vector,
      };
    } catch (err) {
      this.logger.error('embed failed', err);
      throw err;
    }
  }

  /**
   * POST /api/embedding/store
   * Body: { texts: string[] }
   *
   * 将文本数组存入向量库
   */
  @Post('store')
  async store(@Body() body: { texts?: string[] } = {}) {
    try {
      const texts = (Array.isArray(body.texts) ? body.texts : []).filter((t) =>
        t?.trim(),
      );

      if (texts.length === 0) {
        return { ok: false, error: 'texts 不能为空' };
      }

      const result = await this.vectorStore.addTexts(texts);
      const count = await this.vectorStore.count();

      return { ok: true, ...result, totalDocuments: count };
    } catch (err) {
      this.logger.error('store failed', err);
      throw err;
    }
  }

  /**
   * POST /api/embedding/search
   * Body: { query: string, k?: number }
   *
   * 语义搜索：返回最相似的 k 个文档
   */
  @Post('search')
  async search(@Body() body: { query?: string; k?: number } = {}) {
    try {
      const query = body.query?.trim();
      if (!query) {
        return { ok: false, error: 'query 不能为空' };
      }

      const result = await this.vectorStore.search(query, body.k ?? 3);
      return { ok: true, ...result };
    } catch (err) {
      this.logger.error('search failed', err);
      throw err;
    }
  }
}
