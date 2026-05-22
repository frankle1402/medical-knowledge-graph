-- CreateTable
CREATE TABLE "embedding_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "base_url" TEXT,
    "api_key" TEXT,
    "model" TEXT,
    "timeout_ms" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "embedding_config_pkey" PRIMARY KEY ("id")
);

-- Restore HNSW index dropped by Prisma's introspection diff. The HNSW index
-- on nodes.embedding is required for pgvector cosine search (used by RAG
-- semantic search and synonym candidates). Schema.prisma cannot represent
-- vector indexes, so Prisma's schema diff incorrectly proposed dropping it
-- when generating this migration. We restore it as part of the same
-- migration so the DB ends up in the same shape it was in before.
CREATE INDEX IF NOT EXISTS nodes_embedding_idx ON "nodes"
  USING hnsw (embedding vector_cosine_ops);
