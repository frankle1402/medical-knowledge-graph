/**
 * Storage backend switch — selects between Postgres (Pack B) and Neo4j
 * (legacy fallback) for the graph data services. The default is `neo4j`
 * to keep older deployments working until they explicitly opt in.
 *
 * Pack B reads `STORAGE_BACKEND` once at module evaluation time inside each
 * service, so toggling at runtime is not supported by design — restart the
 * process to switch backends. Tests that need to compare backends call
 * `getStorageBackend()` directly after mutating `process.env.STORAGE_BACKEND`.
 */
export type StorageBackend = 'pg' | 'neo4j';

export function getStorageBackend(): StorageBackend {
  const v = process.env.STORAGE_BACKEND?.toLowerCase();
  if (v === 'pg') return 'pg';
  return 'neo4j';
}
