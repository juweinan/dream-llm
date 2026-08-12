// ---------------------------------------------------------------
// 第十一章 11.2 节 — 向量相似度纯函数模块
//
// 零外部依赖，纯 TypeScript 实现。
// 演示余弦相似度 / 欧氏距离计算，并验证
// "L2 归一化后 cosine = dot" 这一关键性质。
// ---------------------------------------------------------------

/**
 * 校验两个向量维度是否一致，不一致则抛出 RangeError。
 */
function assertSameDim(a: number[], b: number[]): void {
  if (a.length !== b.length) {
    throw new RangeError('向量维度不匹配');
  }
}

/**
 * 点积（内积）：Σ a_i * b_i
 */
export function dot(a: number[], b: number[]): number {
  assertSameDim(a, b);
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * L2 范数（欧几里得范数）：sqrt(Σ v_i²)
 */
export function l2Norm(v: number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  return Math.sqrt(sum);
}

/**
 * L2 归一化：返回一个方向相同但长度为 1 的新向量。
 * 若输入为零向量则抛出 RangeError（零向量不可归一化）。
 */
export function normalize(v: number[]): number[] {
  const norm = l2Norm(v);
  if (norm === 0) {
    throw new RangeError('零向量不可归一化');
  }
  const result: number[] = [];
  for (let i = 0; i < v.length; i++) {
    result.push(v[i] / norm);
  }
  return result;
}

/**
 * 余弦相似度：cos(θ) = (a·b) / (||a|| × ||b||)
 *
 * 取值范围 [-1, 1]：
 *  -  1：方向完全相同
 *  -  0：正交（无相关性）
 *  - -1：方向完全相反
 *
 * 若任一向量为零向量则抛出 RangeError。
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  assertSameDim(a, b);
  const normA = l2Norm(a);
  const normB = l2Norm(b);
  if (normA === 0 || normB === 0) {
    throw new RangeError('零向量无法计算余弦相似度');
  }
  return dot(a, b) / (normA * normB);
}

/**
 * 欧氏距离：sqrt(Σ (a_i - b_i)²)
 *
 * 值 ≥ 0，越小表示越"近"。
 */
export function euclideanDistance(a: number[], b: number[]): number {
  assertSameDim(a, b);
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}
