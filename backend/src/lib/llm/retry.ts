/**
 * Retry helper with exponential backoff + jitter.
 *
 * Only retries when the predicate returns true (default: only LLMTransientError).
 * Backoff: delay = base * factor^(attempt-1), with ±jitterRatio multiplicative jitter.
 * After maxAttempts attempts, the last error is re-thrown.
 */

import { LLMTransientError } from './errors.js';

export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Base delay in ms. Default 500. */
  baseMs?: number;
  /** Multiplicative growth factor. Default 2. */
  factor?: number;
  /** Symmetric jitter ratio (0–1). Default 0.25 → ±25%. */
  jitterRatio?: number;
  /** Predicate; only retry when this returns true. Default: instance of LLMTransientError. */
  shouldRetry?: (err: unknown) => boolean;
  /** Sleep function (overridable for tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Random source [0, 1) (overridable for tests). */
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isTransient = (err: unknown): boolean => err instanceof LLMTransientError;

export function computeBackoffMs(
  attempt: number,
  baseMs: number,
  factor: number,
  jitterRatio: number,
  random: () => number,
): number {
  // attempt is 1-based: first wait happens after attempt 1 fails.
  const exp = baseMs * Math.pow(factor, attempt - 1);
  const jitter = 1 + (random() * 2 - 1) * jitterRatio;
  return Math.max(0, Math.round(exp * jitter));
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseMs = options.baseMs ?? 500;
  const factor = options.factor ?? 2;
  const jitterRatio = options.jitterRatio ?? 0.25;
  const shouldRetry = options.shouldRetry ?? isTransient;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !shouldRetry(err)) {
        throw err;
      }
      const wait = computeBackoffMs(attempt, baseMs, factor, jitterRatio, random);
      await sleep(wait);
    }
  }
  // Unreachable (loop either returns or throws); keep TS happy.
  throw lastErr;
}
