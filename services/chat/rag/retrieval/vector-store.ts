// ---------------------------------------------------------------
// 向量存储仓储层 — 纯函数，通过 Prisma.$queryRaw 操作 pgvector
//
// 不直接 import pgvector 客户端，便于复用与单测。
// ---------------------------------------------------------------

// ================================================================
// 类型定义
// ================================================================

/** 向量存储记录 */
export interface VectorStoreRecord {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  embedding: number[];
  modelName: string;
}

/** 相似度搜索结果 */
export interface SearchResult {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  /** 余弦相似度 score = 1 - cosine_distance，范围 [0, 1]，越大越相似 */
  score: number;
}

/** 相似度搜索选项 */
export interface SimilaritySearchOptions {
  /** 返回条数，默认 5 */
  topK?: number;
  /** 库中向量维度，用于入参校验（需与 vector(N) 声明一致） */
  dimension: number;
  /** 可选：按文档 ID 过滤 */
  filterByDocumentId?: string;
}

/** Prisma 客户端最小接口 — 仅暴露 $queryRawUnsafe */
interface PrismaQueryable {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

// ================================================================
// 常量
// ================================================================

/** 默认向量维度 — 与迁移 `embedding vector(384)` 对齐 */
export const VECTOR_DIM = 384;

// ================================================================
// upsertChunks
// ================================================================

/**
 * 批量 upsert 向量块。
 *
 * INSERT ... ON CONFLICT (id) DO UPDATE 保证幂等性：
 * 重复写入同一 id 时更新 embedding、content 等字段。
 */
export async function upsertChunks(
  prisma: PrismaQueryable,
  records: VectorStoreRecord[],
): Promise<void> {
  if (records.length === 0) return;

  for (const r of records) {
    const vectorStr = `[${r.embedding.join(',')}]`;
    await prisma.$queryRawUnsafe(
      `INSERT INTO "DocumentChunk" (id, "documentId", content, "chunkIndex", embedding, "modelName")
       VALUES ($1, $2, $3, $4, $5::vector, $6)
       ON CONFLICT (id) DO UPDATE SET
         "documentId" = EXCLUDED."documentId",
         content = EXCLUDED.content,
         "chunkIndex" = EXCLUDED."chunkIndex",
         embedding = EXCLUDED.embedding,
         "modelName" = EXCLUDED."modelName"`,
      r.id,
      r.documentId,
      r.content,
      r.chunkIndex,
      vectorStr,
      r.modelName,
    );
  }
}

// ================================================================
// similaritySearch
// ================================================================

/**
 * pgvector 余弦相似度检索。
 *
 * 使用 pgvector <=> 运算符（余弦距离），
 * score = 1 - 距离，范围 [0, 1]，越大越相似。
 *
 * **维度校验**：入参 queryVector.length 必须与 options.dimension 一致，
 * 否则抛出 RangeError。
 *
 * @throws RangeError 若 queryVector 长度与 dimension 不一致
 */
export async function similaritySearch(
  prisma: PrismaQueryable,
  queryVector: number[],
  options: SimilaritySearchOptions,
): Promise<SearchResult[]> {
  // ---- 入参维度校验 ----
  if (queryVector.length !== options.dimension) {
    throw new RangeError(
      `向量维度不匹配：queryVector 长度 ${queryVector.length}，期望 ${options.dimension}`,
    );
  }

  const topK = options.topK ?? 5;
  const vectorStr = `[${queryVector.join(',')}]`;

  // 根据是否有 documentId 过滤构建不同 SQL（避免参数序号错位）
  const raw: Array<{
    id: string;
    documentId: string;
    content: string;
    chunkIndex: number;
    score: number;
  }> = options.filterByDocumentId
    ? await prisma.$queryRawUnsafe(
        `SELECT
           id,
           "documentId",
           content,
           "chunkIndex",
           1 - (embedding <=> $1::vector) AS score
         FROM "DocumentChunk"
         WHERE "documentId" = $3
         ORDER BY embedding <=> $1::vector ASC
         LIMIT $2`,
        vectorStr,
        topK,
        options.filterByDocumentId,
      )
    : await prisma.$queryRawUnsafe(
        `SELECT
           id,
           "documentId",
           content,
           "chunkIndex",
           1 - (embedding <=> $1::vector) AS score
         FROM "DocumentChunk"
         ORDER BY embedding <=> $1::vector ASC
         LIMIT $2`,
        vectorStr,
        topK,
      );

  return raw;
}

// ================================================================
// bruteForceKNN — 纯 TypeScript 暴力 KNN（baseline / 单测用）
// ================================================================

/**
 * 暴力 KNN 检索：对候选向量全集计算余弦相似度并返回 topK。
 *
 * 这是 ANN（近似最近邻）的精确 baseline：
 * 在小数据集上可用于验证 pgvector HNSW 结果的一致性。
 *
 * @param queryVector  查询向量
 * @param candidates   候选记录（含 embedding）
 * @param topK         返回条数
 * @param dimension    期望维度（用于校验）
 */
export function bruteForceKNN(
  queryVector: number[],
  candidates: VectorStoreRecord[],
  topK: number,
  dimension: number,
): SearchResult[] {
  if (queryVector.length !== dimension) {
    throw new RangeError(
      `向量维度不匹配：queryVector 长度 ${queryVector.length}，期望 ${dimension}`,
    );
  }

  const scored: SearchResult[] = [];

  for (const c of candidates) {
    if (c.embedding.length !== dimension) {
      throw new RangeError(
        `候选向量维度不匹配：id=${c.id} 长度 ${c.embedding.length}，期望 ${dimension}`,
      );
    }

    // 余弦相似度
    const sim = cosineSimilarity(queryVector, c.embedding);

    scored.push({
      id: c.id,
      documentId: c.documentId,
      content: c.content,
      chunkIndex: c.chunkIndex,
      score: sim,
    });
  }

  // 按 score 降序排列，取 topK
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ================================================================
// 内联向量数学（避免跨模块依赖，保持模块自包含）
// ================================================================

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function l2Norm(v: number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const normA = l2Norm(a);
  const normB = l2Norm(b);
  if (normA === 0 || normB === 0) {
    throw new RangeError('零向量无法计算余弦相似度');
  }
  return dot(a, b) / (normA * normB);
}
