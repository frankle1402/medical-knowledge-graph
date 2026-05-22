/**
 * Embedding runtime config: DB-backed singleton with in-memory cache.
 *
 * Mirrors llm-config.service.ts intentionally — admins can route embeddings to
 * a different provider/model from chat (e.g. local TEI, BGE, Jina) without
 * touching the chat config.
 *
 * Fallback chain when DB row is empty:
 *   base_url  -> LLM_BASE_URL env  (same OpenAI host works for /embeddings)
 *   api_key   -> LLM_API_KEY env
 *   model     -> 'text-embedding-3-small' (1536 dim, matches the pgvector
 *                column width — changing dim requires a separate migration)
 *   timeout_ms-> LLM_TIMEOUT_MS env
 */
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

export interface ResolvedEmbeddingConfig {
  base_url: string;
  api_key: string;
  model: string;
  timeout_ms: number;
}

interface CacheEntry {
  base_url: string | null;
  api_key: string | null;
  model: string | null;
  timeout_ms: number | null;
}

let cache: CacheEntry | null = null;

async function load(): Promise<CacheEntry> {
  // Prisma client may not yet have EmbeddingConfig types if generate hasn't
  // run since the migration; cast through unknown to keep this resilient.
  const client = prisma as unknown as {
    embeddingConfig: {
      findUnique(args: { where: { id: string } }): Promise<CacheEntry | null>;
    };
  };
  const row = await client.embeddingConfig.findUnique({ where: { id: 'default' } });
  cache = row
    ? {
        base_url: row.base_url,
        api_key: row.api_key,
        model: row.model,
        timeout_ms: row.timeout_ms,
      }
    : { base_url: null, api_key: null, model: null, timeout_ms: null };
  return cache;
}

export async function getEmbeddingConfig(): Promise<ResolvedEmbeddingConfig> {
  const c = cache ?? (await load());
  return {
    base_url: c.base_url ?? env.LLM_BASE_URL,
    api_key: c.api_key ?? env.LLM_API_KEY,
    model: c.model ?? DEFAULT_EMBEDDING_MODEL,
    timeout_ms: c.timeout_ms ?? env.LLM_TIMEOUT_MS,
  };
}

export interface EmbeddingConfigUpdate {
  base_url?: string | null;
  api_key?: string | null;
  model?: string | null;
  timeout_ms?: number | null;
}

export async function updateEmbeddingConfig(
  patch: EmbeddingConfigUpdate,
  updatedBy: string,
): Promise<ResolvedEmbeddingConfig> {
  const client = prisma as unknown as {
    embeddingConfig: {
      upsert(args: {
        where: { id: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }): Promise<unknown>;
    };
  };
  await client.embeddingConfig.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...patch, updated_by: updatedBy },
    update: { ...patch, updated_by: updatedBy },
  });
  await load();
  return getEmbeddingConfig();
}

export interface MaskedEmbeddingConfig {
  base_url: string;
  model: string;
  timeout_ms: number;
  api_key_set: boolean;
  api_key_masked: string | null;
  source: {
    base_url: 'db' | 'env';
    api_key: 'db' | 'env';
    model: 'db' | 'default';
    timeout_ms: 'db' | 'env';
  };
  updated_at: Date | null;
  updated_by: string | null;
}

export async function getMaskedEmbeddingConfig(): Promise<MaskedEmbeddingConfig> {
  const client = prisma as unknown as {
    embeddingConfig: {
      findUnique(args: {
        where: { id: string };
      }): Promise<({ updated_at: Date; updated_by: string | null } & CacheEntry) | null>;
    };
  };
  const row = await client.embeddingConfig.findUnique({ where: { id: 'default' } });
  const resolved = await getEmbeddingConfig();
  const apiKey = resolved.api_key;
  return {
    base_url: resolved.base_url,
    model: resolved.model,
    timeout_ms: resolved.timeout_ms,
    api_key_set: apiKey.length > 0,
    api_key_masked: apiKey.length > 0 ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : null,
    source: {
      base_url: row?.base_url ? 'db' : 'env',
      api_key: row?.api_key ? 'db' : 'env',
      model: row?.model ? 'db' : 'default',
      timeout_ms: row?.timeout_ms != null ? 'db' : 'env',
    },
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  };
}

/** For tests. */
export function _resetEmbeddingCache(): void {
  cache = null;
}
