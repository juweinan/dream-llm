import { Injectable, Logger } from '@nestjs/common';
import {
  pipeline,
  type FeatureExtractionPipeline,
  env,
} from '@xenova/transformers';
import { Embeddings } from '@langchain/core/embeddings';
import * as path from 'node:path';

const MODEL_NAME = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

// 指定本地模型目录，禁止联网下载
env.localModelPath = path.resolve(process.cwd(), 'models');
env.allowRemoteModels = false;

/**
 * 基于 @xenova/transformers 的本地嵌入服务。
 * 继承 LangChain 的 Embeddings 抽象类，可直接传入 MemoryVectorStore 使用。
 */
@Injectable()
export class EmbeddingService extends Embeddings {
  private readonly logger = new Logger(EmbeddingService.name);
  private extractor: FeatureExtractionPipeline | null = null;
  private initPromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor() {
    super({});
  }

  /**
   * 延迟加载 + 单例：确保 pipeline 只初始化一次
   */
  private async ensureExtractor(): Promise<FeatureExtractionPipeline> {
    if (this.extractor) return this.extractor;

    // 防止并发调用时多次初始化
    if (!this.initPromise) {
      this.logger.log(`Loading embedding model: ${MODEL_NAME} ...`);
      this.initPromise = pipeline('feature-extraction', MODEL_NAME, {
        quantized: false,
      }).then((extractor) => {
        this.logger.log(`Embedding model loaded: ${MODEL_NAME}`);
        this.extractor = extractor;
        return extractor;
      });
    }

    return this.initPromise;
  }

  /**
   * 对多篇文档进行批量嵌入
   * @param documents 文档文本数组
   * @returns 向量数组，每个向量为 number[]
   */
  async embedDocuments(documents: string[]): Promise<number[][]> {
    const extractor = await this.ensureExtractor();
    const embeddings: number[][] = [];

    for (const doc of documents) {
      // pooling: 'mean' → 对 token 维度取均值，得到句向量
      // normalize: true → L2 归一化，便于后续余弦相似度计算
      const output = await extractor(doc, { pooling: 'mean', normalize: true });
      embeddings.push(Array.from(output.data as Float32Array));
    }

    return embeddings;
  }

  /**
   * 对单个查询文本进行嵌入
   * @param document 查询文本
   * @returns 向量（number[]），维度 = 384
   */
  async embedQuery(document: string): Promise<number[]> {
    const extractor = await this.ensureExtractor();
    const output = await extractor(document, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(output.data as Float32Array);
  }
}
