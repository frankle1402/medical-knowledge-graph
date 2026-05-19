-- pgvector extension + embedding column on nodes
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "nodes" ADD COLUMN "embedding" vector(1536);

-- ivfflat index for cosine similarity. lists=100 is a sensible default for
-- up to ~1M rows; tune later if dataset grows.
-- See: https://github.com/pgvector/pgvector#indexing
CREATE INDEX nodes_embedding_idx ON "nodes"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
