// ---------------------------------------------------------------
// 检索层评测指标 — 纯函数，零依赖
//
// 用于评测向量检索 / RAG 检索阶段的召回与排序质量。
// 所有函数均为纯函数：入参不被修改、无副作用、无 IO。
// ---------------------------------------------------------------

/**
 * 计算逆序增益时使用的对数底（log2）。
 * 位置 i（1-based）对应的增益折现为 1 / log2(i + 1)。
 */

// ================================================================
// Recall@K
// ================================================================

/**
 * Recall@K：相关文档中被检索进 Top-K 的比例。
 *
 *   recall@k = |relevant ∩ retrieved[:k]| / |relevant|
 *
 * - `retrievedIds` 为检索系统返回的排序结果（按相关度降序）。
 * - `relevantIds` 为该查询的真实相关文档 ID 集合。
 * - 无相关文档时返回 1（无遗漏，视为满分）。
 *
 * @throws RangeError 若 k <= 0
 */
export function recallAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number,
): number {
  if (!Number.isInteger(k) || k <= 0) {
    throw new RangeError(`k 必须为正整数，收到 ${k}`);
  }

  const relevantSet = new Set(relevantIds);
  const relCount = relevantSet.size;
  if (relCount === 0) return 1;

  const topK = retrievedIds.slice(0, k);
  const seen = new Set<string>();
  let hit = 0;
  for (const id of topK) {
    // seen 去重：避免 ranked 列表中的重复 ID 重复计数
    if (relevantSet.has(id) && !seen.has(id)) {
      seen.add(id);
      hit++;
    }
  }
  return hit / relCount;
}

// ================================================================
// MRR（Mean Reciprocal Rank）
// ================================================================

/**
 * 单个查询的倒数排名：第一个相关文档出现位置的倒数。
 *
 * 位置从 1 开始计数；若整个列表都没有相关文档则返回 0。
 */
function reciprocalRank(ranked: string[], relevant: Set<string>): number {
  for (let i = 0; i < ranked.length; i++) {
    if (relevant.has(ranked[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * MRR：多个查询的倒数排名平均值。
 *
 *   mrr = (1/|Q|) · Σ_q 1/rank_q
 *
 * - `rankedListsPerQuery[i]` 是第 i 个查询的排序结果。
 * - `relevantPerQuery[i]` 是第 i 个查询的相关文档 ID 集合。
 *
 * 两个数组长度不一致时，按较短者计算。
 *
 * @returns 平均倒数排名，范围 [0, 1]
 */
export function mrr(
  rankedListsPerQuery: string[][],
  relevantPerQuery: string[][],
): number {
  const n = Math.min(
    rankedListsPerQuery.length,
    relevantPerQuery.length,
  );
  if (n === 0) return 0;

  let sum = 0;
  for (let q = 0; q < n; q++) {
    sum += reciprocalRank(rankedListsPerQuery[q], new Set(relevantPerQuery[q]));
  }
  return sum / n;
}

// ================================================================
// NDCG@K
// ================================================================

/**
 * 理想 DCG@K：r 个相关文档全部排在最前时的折现累计增益。
 *
 *   idcg@k = Σ_{i=1}^{r} 1 / log2(i + 1)
 */
function idealDcg(r: number): number {
  let sum = 0;
  for (let i = 1; i <= r; i++) {
    sum += 1 / Math.log2(i + 1);
  }
  return sum;
}

/**
 * NDCG@K：归一化折现累计增益（二元相关度）。
 *
 * 由于 `relevantIds` 是一个集合，本实现采用二元相关度：
 * 命中（文档相关）增益为 1，未命中增益为 0。
 *
 *   dcg@k  = Σ_{i=1}^{k} rel_i / log2(i + 1)
 *   idcg@k = Σ_{i=1}^{min(k, R)} 1 / log2(i + 1)   （R = 相关文档数）
 *   ndcg@k = dcg@k / idcg@k
 *
 * - 完全命中（所有相关文档都在 Top-K 且排在最前）→ 1.0。
 * - 无相关文档时返回 1（无内容可排错，视为满分）。
 *
 * @throws RangeError 若 k <= 0
 */
export function ndcgAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number,
): number {
  if (!Number.isInteger(k) || k <= 0) {
    throw new RangeError(`k 必须为正整数，收到 ${k}`);
  }

  const relevantSet = new Set(relevantIds);
  const relCount = relevantSet.size;
  if (relCount === 0) return 1;

  const idealRelevant = Math.min(k, relCount);
  const idcg = idealDcg(idealRelevant);
  if (idcg === 0) return 0;

  const topK = retrievedIds.slice(0, k);
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    if (relevantSet.has(topK[i])) {
      dcg += 1 / Math.log2(i + 2); // 位置 i（0-based）→ rank i+1 → log2(rank+1)
    }
  }
  return dcg / idcg;
}
