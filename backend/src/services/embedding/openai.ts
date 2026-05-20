/**
 * OpenAI embedding client for semantic search.
 *
 * Why a separate module from `lib/llm/openai-client.ts`:
 * - That client targets `/chat/completions`; this one targets `/embeddings`.
 * - Embeddings are commodity calls — using the official `openai` SDK keeps the
 *   surface area tiny (mostly just `embeddings.create`) and gets us batching
 *   for free.
 * - Pack C tests mock the SDK directly via `vi.mock('openai', ...)`, so no
 *   real network calls happen in the suite.
 *
 * Config resolution mirrors the chat path: DB-backed `LlmConfig` first, falling
 * back to `LLM_API_KEY` / `LLM_BASE_URL` env. We rebuild the SDK client when
 * either value changes so admin updates from `/settings` take effect without
 * a server restart.
 */
import OpenAI from 'openai';
import { getLlmConfig } from '../../modules/system/llm-config.service.js';

let client: OpenAI | null = null;
let lastKey: string | null = null;
let lastBaseUrl: string | null = null;

async function getClient(): Promise<OpenAI> {
  const cfg = await getLlmConfig();
  if (!client || cfg.api_key !== lastKey || cfg.base_url !== lastBaseUrl) {
    client = new OpenAI({
      apiKey: cfg.api_key,
      baseURL: cfg.base_url,
    });
    lastKey = cfg.api_key;
    lastBaseUrl = cfg.base_url;
  }
  return client;
}

/** Reset the cached client. For tests only. */
export function _resetClient(): void {
  client = null;
  lastKey = null;
  lastBaseUrl = null;
}

export const EMBEDDING_MODEL = 'text-embedding-3-small';
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
  const r = await (await getClient()).embeddings.create({
    model: EMBEDDING_MODEL,
    input: truncate(text),
  });
  const v = r.data[0]?.embedding;
  if (!v || v.length !== EMBEDDING_DIM) {
    throw new Error(`embed(): unexpected dim ${v?.length ?? 0}`);
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
  const r = await (await getClient()).embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts.map(truncate),
  });
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const v = r.data[i]?.embedding;
    if (!v || v.length !== EMBEDDING_DIM) {
      throw new Error(`embedBatch(): unexpected dim at ${i}: ${v?.length ?? 0}`);
    }
    out.push(v);
  }
  return out;
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
