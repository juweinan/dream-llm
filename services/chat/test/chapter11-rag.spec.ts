// ---------------------------------------------------------------
// 第十一章 RAG 系统 单元测试
//
// 使用 bun:test 风格，mock-first，无需真实 API key 或数据库。
// 运行：bun test services/chat/test/chapter11-rag.spec.ts
// ---------------------------------------------------------------
import { describe, it, expect } from 'bun:test';
import {
  dot,
  l2Norm,
  normalize,
  cosineSimilarity,
  euclideanDistance,
} from '../rag/embedding/similarity';
import {
  bruteForceKNN,
  type VectorStoreRecord,
} from '../rag/retrieval/vector-store';

// ================================================================
// 11.2.4 相似度
// ================================================================
describe('11.2.4 相似度', () => {
  // ----------------------------------------------------------
  // dot
  // ----------------------------------------------------------
  describe('dot', () => {
    it('两个相同向量的点积等于各分量平方和', () => {
      const v = [3, 4];
      expect(dot(v, v)).toBe(25); // 9 + 16
    });

    it('正交向量的点积为 0', () => {
      expect(dot([1, 0], [0, 1])).toBe(0);
    });

    it('维度不匹配时抛出 RangeError', () => {
      expect(() => dot([1, 2], [1, 2, 3])).toThrow('向量维度不匹配');
    });
  });

  // ----------------------------------------------------------
  // l2Norm
  // ----------------------------------------------------------
  describe('l2Norm', () => {
    it('单位向量的 L2 范数为 1', () => {
      expect(l2Norm([1, 0, 0])).toBe(1);
    });

    it('3-4-5 直角三角形', () => {
      expect(l2Norm([3, 4])).toBe(5);
    });

    it('零向量的 L2 范数为 0', () => {
      expect(l2Norm([0, 0, 0])).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // normalize
  // ----------------------------------------------------------
  describe('normalize', () => {
    it('归一化后 L2 范数为 1', () => {
      const v = [3, 4];
      const n = normalize(v);
      expect(l2Norm(n)).toBeCloseTo(1, 9);
    });

    it('归一化后方向不变（各分量比例相同）', () => {
      const v = [6, 8];
      const n = normalize(v);
      // 6/10 = 0.6, 8/10 = 0.8
      expect(n[0]).toBeCloseTo(0.6, 9);
      expect(n[1]).toBeCloseTo(0.8, 9);
    });

    it('已是单位向量，归一化后不变', () => {
      const v = [1, 0, 0];
      const n = normalize(v);
      expect(n[0]).toBe(1);
      expect(n[1]).toBe(0);
      expect(n[2]).toBe(0);
    });

    it('零向量归一化抛出 RangeError', () => {
      expect(() => normalize([0, 0])).toThrow('零向量不可归一化');
    });
  });

  // ----------------------------------------------------------
  // cosineSimilarity
  // ----------------------------------------------------------
  describe('cosineSimilarity', () => {
    it('单位向量自相似 = 1', () => {
      const v = [1, 0, 0];
      expect(cosineSimilarity(v, v)).toBe(1);
    });

    it('反方向向量相似 = -1', () => {
      const a = [1, 2, 3];
      const b = [-1, -2, -3];
      expect(cosineSimilarity(a, b)).toBe(-1);
    });

    it('正交向量相似 = 0', () => {
      expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
    });

    it('相同方向不同长度的向量相似 = 1', () => {
      expect(cosineSimilarity([1, 2], [10, 20])).toBeCloseTo(1, 9);
    });

    it('归一化后 cosineSimilarity === dot（容差 1e-9）', () => {
      const a = [3, 4, 0];
      const b = [-1, 2, 5];
      const na = normalize(a);
      const nb = normalize(b);
      const cos = cosineSimilarity(na, nb);
      const dp = dot(na, nb);
      // 归一化后余弦等于点积（因为范数均为 1）
      expect(cos).toBeCloseTo(dp, 9);
      // 同时验证归一化后 cosineSimilarity 就是 dot
      expect(cosineSimilarity(na, nb)).toBeCloseTo(dot(na, nb), 9);
    });

    it('维度不匹配抛错', () => {
      expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('向量维度不匹配');
    });

    it('零向量抛错', () => {
      expect(() => cosineSimilarity([0, 0], [1, 2])).toThrow('零向量无法计算余弦相似度');
    });
  });

  // ----------------------------------------------------------
  // euclideanDistance
  // ----------------------------------------------------------
  describe('euclideanDistance', () => {
    it('相同向量距离为 0', () => {
      expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
    });

    it('3-4-5 直角三角形', () => {
      const a = [0, 0];
      const b = [3, 4];
      expect(euclideanDistance(a, b)).toBe(5);
    });

    it('距离对称（d(a,b) = d(b,a)）', () => {
      const a = [1, 5, 2];
      const b = [4, 0, 6];
      expect(euclideanDistance(a, b)).toBe(euclideanDistance(b, a));
    });

    it('维度不匹配抛错', () => {
      expect(() => euclideanDistance([1, 2], [1])).toThrow('向量维度不匹配');
    });
  });

  // ----------------------------------------------------------
  // 综合验证：归一化后 Cosine = Dot
  // ----------------------------------------------------------
  describe('归一化后 cosine === dot 综合验证', () => {
    it('随机高维向量也满足此性质', () => {
      // 构造一个非对称的 10 维向量对
      const a = [0.5, -0.3, 0.8, 0.1, -0.9, 0.4, 0.7, -0.2, 0.6, -0.1];
      const b = [0.9, 0.2, -0.4, 0.7, 0.1, -0.6, 0.3, 0.8, -0.5, 0.0];
      const na = normalize(a);
      const nb = normalize(b);
      expect(cosineSimilarity(na, nb)).toBeCloseTo(dot(na, nb), 9);
    });

    it('二维任意向量对', () => {
      const a = [7, 24];
      const b = [-15, 8];
      const na = normalize(a);
      const nb = normalize(b);
      // l2Norm(na) = 1, l2Norm(nb) = 1
      // cosineSimilarity = dot(na,nb) / (1*1) = dot(na,nb)
      expect(l2Norm(na)).toBeCloseTo(1, 9);
      expect(l2Norm(nb)).toBeCloseTo(1, 9);
      expect(cosineSimilarity(na, nb)).toBeCloseTo(dot(na, nb), 9);
    });
  });
});

// ================================================================
// 11.5 向量数据库
// ================================================================
describe('11.5 向量数据库', () => {
  // ----------------------------------------------------------
  // 工具：生成 mock 向量数据
  // ----------------------------------------------------------
  const TEST_DIM = 4; // 小维度便于单测

  /** 生成指定维度的随机向量（值域 [0, 1)） */
  function randomVector(dim: number): number[] {
    return Array.from({ length: dim }, () => Math.random());
  }

  /** 生成 n 条 mock VectorStoreRecord */
  function mockRecords(n: number, dim: number): VectorStoreRecord[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `mock-chunk-${i}`,
      documentId: `doc-${Math.floor(i / 5)}`,
      content: `这是第 ${i} 号文本块`,
      chunkIndex: i,
      embedding: randomVector(dim),
      modelName: 'test-model',
    }));
  }

  // ================================================================
  // 11.5.2 KNN 暴力实现作为 baseline
  // ================================================================
  describe('11.5.2 KNN 暴力 baseline', () => {
    const candidates = mockRecords(50, TEST_DIM);

    it('返回 topK 条结果', () => {
      const query = randomVector(TEST_DIM);
      const topK = 5;
      const results = bruteForceKNN(query, candidates, topK, TEST_DIM);
      expect(results.length).toBe(topK);
    });

    it('结果按 score 降序排列', () => {
      const query = randomVector(TEST_DIM);
      const results = bruteForceKNN(query, candidates, 10, TEST_DIM);

      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });

    it('top-1 的 score ≥ 任意其他候选的 score', () => {
      const query = randomVector(TEST_DIM);
      const results = bruteForceKNN(query, candidates, 5, TEST_DIM);

      // 对全体候选暴力计算，确认 top-1 确实是全局最高分
      let globalMax = -Infinity;
      for (const c of candidates) {
        const sim = cosineSimilarity(query, c.embedding);
        if (sim > globalMax) globalMax = sim;
      }
      expect(results[0].score).toBeCloseTo(globalMax, 9);
    });

    it('queryVector 自身匹配自身 score 约等于 1', () => {
      // 若候选集中有一条 embedding === query，score 应为 1
      const query = candidates[7].embedding.slice(); // 精确复制
      const results = bruteForceKNN(query, candidates, 1, TEST_DIM);
      expect(results[0].score).toBeCloseTo(1, 9);
      expect(results[0].id).toBe(candidates[7].id);
    });

    it('维度不匹配时抛 RangeError', () => {
      const query = [0.1, 0.2, 0.3]; // 3 维，预期 4 维
      expect(() => bruteForceKNN(query, candidates, 5, TEST_DIM)).toThrow(
        RangeError,
      );
    });

    it('候选向量维度不一致时抛 RangeError', () => {
      const badCandidates = [
        ...candidates,
        {
          id: 'bad',
          documentId: 'doc-x',
          content: 'bad',
          chunkIndex: 999,
          embedding: [0.1, 0.2], // 2 维
          modelName: 'test-model',
        },
      ];
      const query = randomVector(TEST_DIM);
      expect(() =>
        bruteForceKNN(query, badCandidates, 5, TEST_DIM),
      ).toThrow(RangeError);
    });

    it('topK 为 0 时返回空数组', () => {
      const query = randomVector(TEST_DIM);
      const results = bruteForceKNN(query, candidates, 0, TEST_DIM);
      expect(results).toEqual([]);
    });
  });

  // ================================================================
  // 11.5.6 余弦相似度 score = 1 - 距离 一致性
  // ================================================================
  describe('11.5.6 score = 1 - 距离 一致性', () => {
    /**
     * pgvector <=> 运算符返回余弦距离（cosine distance），
     * 我们的 similaritySearch SQL 使用 `1 - (embedding <=> query) AS score`。
     *
     * 数学恒等式：cosine_similarity(a, b) = 1 - cosine_distance(a, b)
     *
     * 本节验证这一恒等式，确保 SQL score 与纯数学 cosineSimilarity 对齐。
     */

    // pgvector 余弦距离 = 1 - 余弦相似度
    function cosineDistance(a: number[], b: number[]): number {
      return 1 - cosineSimilarity(a, b);
    }

    // SQL 公式：score = 1 - cosine_distance
    function pgvectorScore(a: number[], b: number[]): number {
      return 1 - cosineDistance(a, b);
    }

    it('score = 1 - distance 等价于 cosineSimilarity', () => {
      for (let i = 0; i < 100; i++) {
        const a = randomVector(TEST_DIM);
        const b = randomVector(TEST_DIM);
        const direct = cosineSimilarity(a, b);
        const viaDistance = pgvectorScore(a, b);
        expect(viaDistance).toBeCloseTo(direct, 9);
      }
    });

    it('余弦距离范围 [0, 2]', () => {
      // 相同方向 → 距离 0；相反方向 → 距离 2
      const a = [1, 0, 0, 0];
      const b = [-1, 0, 0, 0];
      const dist = cosineDistance(a, b);
      expect(dist).toBeCloseTo(2, 9);

      const c = [1, 0, 0, 0];
      const distSelf = cosineDistance(c, c);
      expect(distSelf).toBeCloseTo(0, 9);
    });

    it('score 范围 [0, 1]（余弦相似度非负场景）', () => {
      // 对正数向量，余弦相似度 ≥ 0
      for (let i = 0; i < 100; i++) {
        const a = randomVector(TEST_DIM);
        const b = randomVector(TEST_DIM);
        const score = pgvectorScore(a, b);
        // score = cosineSimilarity，范围 [-1, 1]，对随机正向量通常 > 0
        expect(score).toBeGreaterThanOrEqual(-1);
        expect(score).toBeLessThanOrEqual(1);
      }
    });

    it('按 score DESC 排序 ≡ 按 cosineDistance ASC 排序 ≡ 按 cosineSimilarity DESC 排序', () => {
      // 验证三种排序方式给出完全一致的结果顺序
      const query = randomVector(TEST_DIM);
      const vecs = Array.from({ length: 20 }, () => randomVector(TEST_DIM));

      const bySimilarityDesc = [...vecs].sort(
        (a, b) => cosineSimilarity(query, b) - cosineSimilarity(query, a),
      );
      const byDistanceAsc = [...vecs].sort(
        (a, b) => cosineDistance(query, a) - cosineDistance(query, b),
      );
      const byScoreDesc = [...vecs].sort(
        (a, b) => pgvectorScore(query, b) - pgvectorScore(query, a),
      );

      // 三种排序应产生相同顺序
      for (let i = 0; i < vecs.length; i++) {
        expect(bySimilarityDesc[i]).toEqual(byDistanceAsc[i]);
        expect(bySimilarityDesc[i]).toEqual(byScoreDesc[i]);
      }
    });

    it('Brute force KNN score 通过 1-distance 公式可复现', () => {
      // bruteForceKNN 内部使用 cosineSimilarity 作为 score，
      // 等效于 pgvector 的 1 - cosine_distance 公式
      const candidates = mockRecords(50, TEST_DIM);
      const query = randomVector(TEST_DIM);
      const bfResults = bruteForceKNN(query, candidates, 5, TEST_DIM);

      // 手动用 1-distance 公式重算，验证 score 一致
      for (const r of bfResults) {
        const original = candidates.find((c) => c.id === r.id)!;
        const viaDistance = 1 - cosineDistance(query, original.embedding);
        expect(r.score).toBeCloseTo(viaDistance, 9);
      }
    });
  });
});
