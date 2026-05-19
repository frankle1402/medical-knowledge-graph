/**
 * Storage backend switch — selects between Postgres (Pack B) and Neo4j
 * (legacy fallback) for the graph data services. The default is `neo4j`
 * to keep older deployments working until they explicitly opt in.
 *
 * Resolution is per-call by design: each `getStorageBackend()` reads
 * `process.env.STORAGE_BACKEND` afresh so tests can flip backends mid-suite
 * (the parity run sets `STORAGE_BACKEND=neo4j` for the same test files that
 * default to `pg`). In production, set `STORAGE_BACKEND` once at process
 * start — the per-call cost is a single env lookup and is negligible, but
 * mutating the env at runtime is not a supported configuration pattern.
 */
export type StorageBackend = 'pg' | 'neo4j';

export function getStorageBackend(): StorageBackend {
  const v = process.env.STORAGE_BACKEND?.toLowerCase();
  if (v === 'pg') return 'pg';
  return 'neo4j';
}
