/**
 * OpenAI-compatible Chat Completions client.
 *
 * Direct fetch instead of the official SDK so we can swap to GPT-4o / Claude /
 * DeepSeek / 智谱 by toggling LLM_BASE_URL. All HTTP failures are mapped onto
 * typed errors so callers can decide whether to retry.
 */

import { getLlmConfig } from '../../modules/system/llm-config.service.js';
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
  /**
   * Cap on output tokens. Default `undefined` (let the upstream pick), but for
   * structured-output prompts (graph generation) callers should pass a high
   * value (e.g. 8192) since OpenAI-compatible gateways sometimes default to
   * 1024–4096 and silently truncate the JSON, producing schema validation
   * errors that look like the model misbehaved.
   */
  maxTokens?: number;
  /** AbortSignal from the caller (composed with timeoutMs). */
  signal?: AbortSignal;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string;
  }>;
}

// 520–527 are Cloudflare-originated "origin unreachable" errors — treat as transient.
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527]);

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
  const cfg = await getLlmConfig();
  const baseUrl = opts.baseUrl ?? cfg.base_url;
  const apiKey = opts.apiKey ?? cfg.api_key;
  const model = opts.model ?? cfg.model;
  const timeoutMs = opts.timeoutMs ?? cfg.timeout_ms;

  const body: Record<string, unknown> = {
    model,
    messages: buildMessages(opts),
    temperature: opts.temperature ?? 0.2,
  };
  if (opts.maxTokens !== undefined) {
    body.max_tokens = opts.maxTokens;
  }
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
      throw new LLMTransientError(`LLM transient failure ${res.status}: ${detail}`, res.status);
    }
    throw new LLMError(`LLM call failed ${res.status}: ${detail}`);
  }

  // Read body as text first so we can give a useful diagnostic when the
  // upstream returns HTML (typical when base_url is wrong or a proxy gateway
  // serves a login page on auth failure). Older test mocks may only expose
  // .json(), so fall back to that path when .text() / headers aren't there.
  const contentType = res.headers?.get?.('content-type') ?? '';
  let bodyText: string | null = null;
  if (typeof res.text === 'function') {
    try {
      bodyText = await res.text();
    } catch (err) {
      throw new LLMTransientError('LLM response body could not be read', undefined, {
        cause: err,
      });
    }

    const looksLikeHtml = /^\s*<(!doctype|html|head|body)/i.test(bodyText);
    if (looksLikeHtml || contentType.includes('text/html')) {
      throw new LLMError(
        `LLM 接口返回了 HTML 而非 JSON，通常是 base_url 配错（漏了 /v1）或代理网关返回登录页。base_url=${baseUrl}, content-type=${contentType || 'unknown'}, body[0..120]=${bodyText.slice(0, 120)}`,
      );
    }
  }

  let data: ChatCompletionResponse;
  try {
    data =
      bodyText !== null
        ? (JSON.parse(bodyText) as ChatCompletionResponse)
        : ((await res.json()) as ChatCompletionResponse);
  } catch (err) {
    const sample = bodyText ? bodyText.slice(0, 120) : '(unreadable)';
    throw new LLMError(
      `LLM 接口返回了非 JSON 内容。base_url=${baseUrl}, content-type=${contentType || 'unknown'}, body[0..120]=${sample}`,
      { cause: err },
    );
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new LLMError('LLM response missing choices[0].message.content');
  }
  // OpenAI-compatible APIs report finish_reason="length" when the response
  // hit max_tokens. Surface that explicitly — otherwise the truncated JSON
  // makes its way to the parser and the user sees a confusing zod error
  // (e.g. "nodes.16.name: Required") instead of "你的输出超出 token 上限".
  const finish = data.choices?.[0]?.finish_reason;
  if (finish === 'length') {
    throw new LLMError(
      `LLM 输出被 token 上限截断（finish_reason=length）。请把模板里 max_tokens 调大，或减少一次请求里的章节内容。当前 max_tokens=${opts.maxTokens ?? '(默认)'}，输出长度=${content.length} 字符。`,
    );
  }
  return content;
}
