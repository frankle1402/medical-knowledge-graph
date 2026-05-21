/**
 * AI module's bridge between the low-level LLM client and the rest of the
 * orchestrator. Adds:
 *
 * 1. JSON parsing (with markdown fence stripping) → LLMParseError on failure.
 * 2. Zod validation against AIGenerateOutput.
 * 3. Retry wrapping around chatCompletion (transient errors only).
 */

import { AIGenerateOutput } from '@mkg/shared';

import {
  LLMParseError,
  chatCompletion,
  retry,
  type ChatCompletionOptions,
  type RetryOptions,
} from '../../lib/llm/index.js';

const FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;

// JSON only allows: \" \\ \/ \b \f \n \r \t \uXXXX
// LLMs sometimes emit \中 \第 \k etc. — strip the backslash so JSON.parse succeeds.
function sanitizeJsonEscapes(s: string): string {
  return s.replace(/\\([^"\\/bfnrtu])/g, '$1');
}

/**
 * Parse a raw LLM string into a validated AIGenerateOutput.
 *
 * - Strips ```json ... ``` markdown fences.
 * - Parses JSON.
 * - Validates against the Agent-F AIGenerateOutput schema.
 *
 * Throws LLMParseError on any failure (caller decides whether to retry — by
 * default, parse errors are NOT retried because LLM output for the same prompt
 * tends to be deterministic in shape).
 */
export function parseLLMOutput(raw: string): AIGenerateOutput {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new LLMParseError('LLM returned empty content', raw);
  }
  const match = FENCE_PATTERN.exec(raw);
  const candidate = sanitizeJsonEscapes((match?.[1] ?? raw).trim());

  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch (err) {
    throw new LLMParseError(
      `LLM output is not valid JSON: ${(err as Error).message}`,
      raw,
      { cause: err },
    );
  }

  // LLMs sometimes use alternative field names instead of `name`.
  // Normalize before schema validation so a single bad field doesn't fail the job.
  if (json && typeof json === 'object' && Array.isArray((json as Record<string, unknown>).nodes)) {
    (json as Record<string, unknown>).nodes = ((json as Record<string, unknown>).nodes as unknown[]).map(
      (n: unknown) => {
        if (!n || typeof n !== 'object') return n;
        const node = n as Record<string, unknown>;
        if (!node.name) {
          node.name = node.title ?? node.step_name ?? node.term_name ?? node.node_name ?? node.label ?? '(unnamed)';
        }
        return node;
      },
    );
  }

  const result = AIGenerateOutput.safeParse(json);
  if (!result.success) {
    throw new LLMParseError(
      `LLM output failed schema validation: ${result.error.message}`,
      raw,
      { cause: result.error },
    );
  }
  return result.data;
}

export interface GenerateAndParseOptions {
  chat: ChatCompletionOptions;
  retry?: RetryOptions;
}

// 429 "cooling down" messages typically ask for 3–10s. Start at 8s so the
// first retry lands after the cooldown window. 5 attempts × exponential
// backoff (8s→16s→32s→64s) gives ~2 minutes of grace before giving up.
const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 5,
  baseMs: 8_000,
  factor: 2,
  jitterRatio: 0.25,
};

/**
 * Calls the LLM with retry-on-transient and parses the response into a
 * validated AIGenerateOutput.
 *
 * - Transient errors (429, 5xx) retried with exponential backoff starting at 8s.
 * - Auth and parse errors are NOT retried.
 */
export async function generateStructured(
  options: GenerateAndParseOptions,
): Promise<{ raw: string; output: AIGenerateOutput }> {
  const retryOpts = { ...DEFAULT_RETRY, ...options.retry };
  const raw = await retry(() => chatCompletion(options.chat), retryOpts);
  const output = parseLLMOutput(raw);
  return { raw, output };
}
