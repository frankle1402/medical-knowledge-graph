/**
 * LLM runtime config: DB-backed singleton with in-memory cache.
 *
 * - Read path is hot (every chat call), so we cache the row and refresh after writes.
 * - Falls back to env defaults for any field left null in DB.
 * - api_key is stored as-is (Postgres column). Mask before exposing over HTTP.
 */
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';

export interface ResolvedLlmConfig {
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
  const row = await prisma.llmConfig.findUnique({ where: { id: 'default' } });
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

export async function getLlmConfig(): Promise<ResolvedLlmConfig> {
  const c = cache ?? (await load());
  return {
    base_url: c.base_url ?? env.LLM_BASE_URL,
    api_key: c.api_key ?? env.LLM_API_KEY,
    model: c.model ?? env.LLM_MODEL,
    timeout_ms: c.timeout_ms ?? env.LLM_TIMEOUT_MS,
  };
}

export interface LlmConfigUpdate {
  base_url?: string | null;
  api_key?: string | null;
  model?: string | null;
  timeout_ms?: number | null;
}

export async function updateLlmConfig(
  patch: LlmConfigUpdate,
  updatedBy: string,
): Promise<ResolvedLlmConfig> {
  await prisma.llmConfig.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...patch, updated_by: updatedBy },
    update: { ...patch, updated_by: updatedBy },
  });
  await load();
  return getLlmConfig();
}

export interface MaskedLlmConfig {
  base_url: string;
  model: string;
  timeout_ms: number;
  api_key_set: boolean;
  api_key_masked: string | null;
  source: {
    base_url: 'db' | 'env';
    api_key: 'db' | 'env';
    model: 'db' | 'env';
    timeout_ms: 'db' | 'env';
  };
  updated_at: Date | null;
  updated_by: string | null;
}

export async function getMaskedLlmConfig(): Promise<MaskedLlmConfig> {
  const row = await prisma.llmConfig.findUnique({ where: { id: 'default' } });
  const resolved = await getLlmConfig();
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
      model: row?.model ? 'db' : 'env',
      timeout_ms: row?.timeout_ms != null ? 'db' : 'env',
    },
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  };
}

/** For tests. */
export function _resetCache(): void {
  cache = null;
}
