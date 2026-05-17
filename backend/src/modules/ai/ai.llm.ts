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
  const candidate = (match?.[1] ?? raw).trim();

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

/**
 * Calls the LLM with retry-on-transient and parses the response into a
 * validated AIGenerateOutput.
 *
 * - Transient errors retried per RetryOptions defaults (3 attempts, 500ms base,
 *   factor 2, ±25% jitter).
 * - Auth and parse errors are NOT retried.
 */
export async function generateStructured(
  options: GenerateAndParseOptions,
): Promise<{ raw: string; output: AIGenerateOutput }> {
  const raw = await retry(() => chatCompletion(options.chat), options.retry);
  const output = parseLLMOutput(raw);
  return { raw, output };
}
