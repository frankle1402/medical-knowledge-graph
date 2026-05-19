-- Pack A review fix W3 — swap ivfflat → HNSW for the embedding index.
--
-- ivfflat needs a non-empty table to train its centroids and degrades on
-- writes. HNSW builds incrementally, has better recall at our scale, and
-- needs no list-count tuning. pgvector defaults (m=16, ef_construction=64)
-- are appropriate for ≤ low millions of rows; revisit if we exceed that.
--
-- The original index from 20260519105007_add_pgvector held no data (no
-- embeddings have been written yet), so dropping is free.

DROP INDEX IF EXISTS nodes_embedding_idx;

CREATE INDEX nodes_embedding_idx ON "nodes"
  USING hnsw (embedding vector_cosine_ops);
