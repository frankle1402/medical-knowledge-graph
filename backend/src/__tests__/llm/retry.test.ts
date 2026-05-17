import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  LLMAuthError,
  LLMTransientError,
  computeBackoffMs,
  retry,
} from '../../lib/llm/index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('retry()', () => {
  it('returns the first successful result without sleeping', async () => {
    const sleep = vi.fn();
    const fn = vi.fn().mockResolvedValue('ok');
    const out = await retry(fn, { sleep, maxAttempts: 3 });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries transient errors up to maxAttempts and eventually succeeds', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new LLMTransientError('blip 1', 503))
      .mockRejectedValueOnce(new LLMTransientError('blip 2', 503))
      .mockResolvedValueOnce('finally');

    const out = await retry(fn, {
      sleep,
      maxAttempts: 3,
      baseMs: 100,
      factor: 2,
      jitterRatio: 0,
      random: () => 0.5,
    });

    expect(out).toBe('finally');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    // Backoff schedule: 100, 200 (no jitter)
    expect(sleep.mock.calls[0]![0]).toBe(100);
    expect(sleep.mock.calls[1]![0]).toBe(200);
  });

  it('does NOT retry non-transient errors (LLMAuthError)', async () => {
    const sleep = vi.fn();
    const fn = vi.fn().mockRejectedValue(new LLMAuthError('no key', 401));

    await expect(
      retry(fn, { sleep, maxAttempts: 5, baseMs: 10 }),
    ).rejects.toBeInstanceOf(LLMAuthError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('throws the last transient error after maxAttempts', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const last = new LLMTransientError('still blipping', 503);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new LLMTransientError('blip 1', 503))
      .mockRejectedValueOnce(new LLMTransientError('blip 2', 503))
      .mockRejectedValueOnce(last);

    await expect(retry(fn, { sleep, maxAttempts: 3, baseMs: 1 })).rejects.toBe(last);
    expect(fn).toHaveBeenCalledTimes(3);
    // Sleeps only happen between failed attempts: 2 sleeps for 3 attempts.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('uses ±25% jitter by default (computeBackoffMs)', () => {
    // random=0 → multiplier 1 + (0*2-1) * 0.25 = 0.75 → 500 * 0.75 = 375
    expect(computeBackoffMs(1, 500, 2, 0.25, () => 0)).toBe(375);
    // random=1 → multiplier 1 + (1*2-1) * 0.25 = 1.25 → 500 * 1.25 = 625
    expect(computeBackoffMs(1, 500, 2, 0.25, () => 1)).toBe(625);
    // random=0.5 → multiplier 1 → exact base
    expect(computeBackoffMs(1, 500, 2, 0.25, () => 0.5)).toBe(500);
    // attempt 2 with factor 2, no jitter
    expect(computeBackoffMs(2, 500, 2, 0, () => 0.5)).toBe(1000);
    // attempt 3 with factor 2, no jitter
    expect(computeBackoffMs(3, 500, 2, 0, () => 0.5)).toBe(2000);
  });

  it('respects custom shouldRetry predicate', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('custom'))
      .mockResolvedValueOnce('ok');
    const out = await retry(fn, {
      sleep,
      maxAttempts: 3,
      baseMs: 1,
      shouldRetry: (e) => e instanceof Error && e.message === 'custom',
    });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
