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
