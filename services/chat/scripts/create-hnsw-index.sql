-- ================================================================
-- HNSW 索引创建脚本 — document_chunks.embedding
--
-- 用途：为 pgvector 余弦相似度检索建立 HNSW 近似最近邻索引，
--       显著加速 Top-K 查询（尤其百万级向量规模）。
--
-- 执行时机：全量 embedding 入库之后再执行本脚本。
--           HNSW 索引在空表或少量数据上建索引会导致搜索精度下降，
--           且在数据插入过程中增量维护索引成本较高。
--           推荐流程：
--             1. 批量 upsert 所有 document_chunks
--             2. 执行本脚本建索引
--             3. 后续新增数据量较大时可 REINDEX INDEX idx_document_chunks_hnsw
--
-- 执行方式（示例）：
--   psql "$DATABASE_URL" -f services/chat/scripts/create-hnsw-index.sql
--
-- 参数说明：
--   m                = 16  每个节点的最大连接数（默认 16，范围 2–100）
--   ef_construction  = 64  构建时动态候选列表大小（默认 64，越大构建越慢但越精确）
--   vector_cosine_ops      余弦距离运算符族（与 <=> 运算符匹配）
-- ================================================================

-- 1. 确保 vector 扩展已启用
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 创建 HNSW 索引
--    IF NOT EXISTS 避免重复执行报错（PostgreSQL 14+ / pgvector 0.5+）
CREATE INDEX IF NOT EXISTS idx_document_chunks_hnsw
  ON "DocumentChunk"
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 3. 验证索引创建成功
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'DocumentChunk' AND indexname = 'idx_document_chunks_hnsw';
