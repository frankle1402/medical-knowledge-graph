import type { Request, Response, NextFunction } from 'express';
import { getStorageBackend } from '../lib/storage-backend.js';

/**
 * Guard for routes that only work on the Postgres backend (Pack C RAG /
 * Pack D learning). These rely on pgvector and recursive CTEs, neither of
 * which the legacy Neo4j path exposes.
 *
 * Without this guard, requests would silently 404 on every node lookup
 * because services like `learningPath` go straight through Prisma — and an
 * operator running with the default `STORAGE_BACKEND=neo4j` would see the
 * generic "node not found" message even when the node exists in Neo4j.
 *
 * 503 (not 501) so it slots into the same "feature temporarily unavailable"
 * bucket the frontend already handles for OpenAI outages.
 */
export function requirePgBackend(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (getStorageBackend() === 'pg') {
    next();
    return;
  }
  res.status(503).json({
    error: 'pg_backend_required',
    hint: '该功能仅在 STORAGE_BACKEND=pg 模式下可用，请在 .env 中配置后重启后端',
  });
}
