/**
 * OpenAI-compatible embedding client for semantic search.
 *
 * Why a separate module from `lib/llm/openai-client.ts`:
 * - That client targets `/chat/completions`; this one targets `/embeddings`.
 * - Embeddings are commodity calls — using the official `openai` SDK keeps the
 *   surface area tiny (mostly just `embeddings.create`) and gets us batching
 *   for free.
 * - Pack C tests mock the SDK directly via `vi.mock('openai', ...)`, so no
 *   real network calls happen in the suite.
 *
 * Config resolution: DB-backed `EmbeddingConfig` (separate from `LlmConfig` so
 * admins can route embeddings to a different provider/model from chat) with
 * env fallback. We rebuild the SDK instance when api_key, base_url, or model
 * changes so admin updates from `/settings` take effect without restart.
 *
 * IMPORTANT: the pgvector column is fixed at `vector(1536)` — only models that
 * emit 1536-dim vectors (e.g. text-embedding-3-small, text-embedding-ada-002)
 * are compatible at write time. Switching to a different dimension (e.g.
 * text-embedding-3-large at 3072) requires a separate column-recreate
 * migration and a full re-backfill. The admin UI surfaces the actual returned
 * dim on its test button to make that obvious.
 */
import OpenAI from 'openai';
import { getEmbeddingConfig } from '../../modules/system/embedding-config.service.js';

interface ClientCache {
  client: OpenAI;
  apiKey: string;
  baseUrl: string;
  model: string;
}

let cached: ClientCache | null = null;

/**
 * Resolve the SDK client + currently-configured model. Both are returned
 * together because `embeddings.create({ model })` needs the value the admin
 * picked, not a hardcoded constant.
 */
async function getClientAndModel(): Promise<{ client: OpenAI; model: string }> {
  const cfg = await getEmbeddingConfig();
  if (
    !cached ||
    cfg.api_key !== cached.apiKey ||
    cfg.base_url !== cached.baseUrl ||
    cfg.model !== cached.model
  ) {
    cached = {
      client: new OpenAI({ apiKey: cfg.api_key, baseURL: cfg.base_url }),
      apiKey: cfg.api_key,
      baseUrl: cfg.base_url,
      model: cfg.model,
    };
  }
  return { client: cached.client, model: cached.model };
}

/** Reset the cached client. For tests only. */
export function _resetClient(): void {
  cached = null;
}

/** Default model — only used to label legacy callers; runtime reads from config. */
export const EMBEDDING_MODEL = 'text-embedding-3-small';
/** Width of the pgvector column — must match the resolved model's output dim. */
export const EMBEDDING_DIM = 1536;

/** OpenAI's hard-ish input limit per item. We trim defensively. */
const MAX_INPUT_CHARS = 8000;

function truncate(s: string): string {
  return s.length > MAX_INPUT_CHARS ? s.slice(0, MAX_INPUT_CHARS) : s;
}

/**
 * Embed a single string. Throws on API failure or unexpected response shape —
 * caller decides whether to retry / queue / give up.
 */
export async function embed(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('embed(): empty text');
  }
  const { client, model } = await getClientAndModel();
  const r = await client.embeddings.create({
    model,
    input: truncate(text),
  });
  const v = r.data[0]?.embedding;
  if (!v || v.length !== EMBEDDING_DIM) {
    throw new Error(
      `embed(): unexpected dim ${v?.length ?? 0} (expected ${EMBEDDING_DIM}, model="${model}")`,
    );
  }
  return v;
}

/**
 * Embed multiple strings in a single API call (more efficient — used by the
 * backfill script). Returns vectors in the same order as input. Throws if any
 * vector has the wrong dimension.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  for (const t of texts) {
    if (!t || t.trim().length === 0) {
      throw new Error('embedBatch(): empty text in batch');
    }
  }
  const { client, model } = await getClientAndModel();
  const r = await client.embeddings.create({
    model,
    input: texts.map(truncate),
  });
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const v = r.data[i]?.embedding;
    if (!v || v.length !== EMBEDDING_DIM) {
      throw new Error(
        `embedBatch(): unexpected dim at ${i}: ${v?.length ?? 0} (expected ${EMBEDDING_DIM}, model="${model}")`,
      );
    }
    out.push(v);
  }
  return out;
}

/**
 * Probe the configured embedding endpoint with one call. Used by the admin
 * "Test connection" button. Returns the actual returned dim so the admin can
 * see at a glance whether the chosen model is compatible with the pgvector
 * column width (1536).
 */
export async function probeEmbedding(
  text = '连接测试',
  override?: { base_url?: string; api_key?: string; model?: string; timeout_ms?: number },
): Promise<{ dim: number; model: string; base_url: string; latency_ms: number }> {
  const cfg = await getEmbeddingConfig();
  const apiKey = override?.api_key && override.api_key.length > 0 ? override.api_key : cfg.api_key;
  const baseUrl = override?.base_url ?? cfg.base_url;
  const model = override?.model ?? cfg.model;

  const ephemeral = new OpenAI({ apiKey, baseURL: baseUrl });
  const startedAt = Date.now();
  const r = await ephemeral.embeddings.create({
    model,
    input: truncate(text),
  });
  const v = r.data[0]?.embedding;
  if (!v || !Array.isArray(v)) {
    throw new Error('probeEmbedding(): response missing embeddings[0].embedding');
  }
  return {
    dim: v.length,
    model,
    base_url: baseUrl,
    latency_ms: Date.now() - startedAt,
  };
}

/**
 * Build the input string we feed into the embedding model for a node.
 * Combines name + description + tags so semantically equivalent nodes that
 * differ in surface form ("心率失常" vs "心律失常") still cluster well.
 */
export function nodeEmbeddingText(node: {
  name: string;
  description?: string | null;
  tags?: unknown;
}): string {
  const parts: string[] = [node.name];
  if (node.description && node.description.trim().length > 0) {
    parts.push(node.description);
  }
  if (Array.isArray(node.tags) && node.tags.length > 0) {
    const tagStrs = (node.tags as unknown[])
      .filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (tagStrs.length > 0) parts.push(tagStrs.join(', '));
  }
  return parts.join('\n');
}
