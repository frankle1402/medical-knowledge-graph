/**
 * OpenAI-compatible Chat Completions client.
 *
 * Direct fetch instead of the official SDK so we can swap to GPT-4o / Claude /
 * DeepSeek / 智谱 by toggling LLM_BASE_URL. All HTTP failures are mapped onto
 * typed errors so callers can decide whether to retry.
 */

import { env } from '../../config/env.js';
import { LLMAuthError, LLMTransientError, LLMError } from './errors.js';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionOptions {
  /** System prompt. */
  system: string;
  /** User prompt (already rendered). */
  user: string;
  /** Optional pre-built messages; overrides {system, user} when provided. */
  messages?: ChatMessage[];
  /** Default 0.2. */
  temperature?: number;
  /** When 'json_object', sets OpenAI response_format. */
  responseFormat?: 'json_object' | 'text';
  /** Override default LLM_MODEL from env. */
  model?: string;
  /** Override default LLM_BASE_URL from env. */
  baseUrl?: string;
  /** Override default LLM_API_KEY from env. */
  apiKey?: string;
  /** Hard timeout in ms. Default LLM_TIMEOUT_MS env. */
  timeoutMs?: number;
  /** AbortSignal from the caller (composed with timeoutMs). */
  signal?: AbortSignal;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string;
  }>;
}

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function buildMessages(opts: ChatCompletionOptions): ChatMessage[] {
  if (opts.messages && opts.messages.length > 0) {
    return opts.messages;
  }
  return [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.user },
  ];
}

/**
 * Performs a single chat-completion call. Does NOT retry — wrap with the
 * retry helper for that. Throws typed LLM errors.
 */
export async function chatCompletion(opts: ChatCompletionOptions): Promise<string> {
  const baseUrl = opts.baseUrl ?? env.LLM_BASE_URL;
  const apiKey = opts.apiKey ?? env.LLM_API_KEY;
  const model = opts.model ?? env.LLM_MODEL;
  const timeoutMs = opts.timeoutMs ?? env.LLM_TIMEOUT_MS;

  const body: Record<string, unknown> = {
    model,
    messages: buildMessages(opts),
    temperature: opts.temperature ?? 0.2,
  };
  if (opts.responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Compose external signal with our timeout
  const externalSignal = opts.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // Network / abort failures are transient.
    const msg = err instanceof Error ? err.message : String(err);
    throw new LLMTransientError(`LLM network error: ${msg}`, undefined, { cause: err });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      detail = '<unreadable>';
    }
    if (res.status === 401 || res.status === 403) {
      throw new LLMAuthError(`LLM auth failed (${res.status}): ${detail}`, res.status);
    }
    if (TRANSIENT_STATUS.has(res.status)) {
      throw new LLMTransientError(
        `LLM transient failure ${res.status}: ${detail}`,
        res.status,
      );
    }
    throw new LLMError(`LLM call failed ${res.status}: ${detail}`);
  }

  let data: ChatCompletionResponse;
  try {
    data = (await res.json()) as ChatCompletionResponse;
  } catch (err) {
    throw new LLMTransientError('LLM response was not valid JSON', undefined, {
      cause: err,
    });
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new LLMError('LLM response missing choices[0].message.content');
  }
  return content;
}
