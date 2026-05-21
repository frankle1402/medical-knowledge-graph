-- AlterTable: add tags JSONB column to relations for v2 medical KG extras
-- (direction_explanation, evidence_quote, reason, etc.)
ALTER TABLE "relations" ADD COLUMN "tags" JSONB NOT NULL DEFAULT '{}';

-- Defensive: ensure HNSW vector index on nodes.embedding still exists.
-- Prisma's auto-generated migration wants to DROP this index because it does
-- not understand pgvector's index type. We re-create it here if missing so
-- semantic search keeps working after this migration applies.
-- (See project memory: prisma-migrate-drops-hnsw-vector-index.md)
CREATE INDEX IF NOT EXISTS nodes_embedding_idx
  ON "nodes" USING hnsw (embedding vector_cosine_ops);
