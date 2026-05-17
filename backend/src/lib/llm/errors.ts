/**
 * Typed errors for LLM operations.
 *
 * Retry policy distinguishes between:
 * - LLMTransientError: network blips, 5xx, 408, 429 — retry with exponential backoff.
 * - LLMAuthError: 401/403 — never retry; misconfiguration.
 * - LLMParseError: response body is not JSON or fails Zod validation — never retry
 *   (the same prompt will produce the same garbage; surface to caller).
 */

export class LLMError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'LLMError';
    if (options?.cause !== undefined) {
      // Preserve cause chain for diagnostics
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export class LLMTransientError extends LLMError {
  /** HTTP status code, when applicable (5xx, 408, 429). */
  public readonly status?: number | undefined;

  constructor(message: string, status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LLMTransientError';
    this.status = status;
  }
}

export class LLMAuthError extends LLMError {
  public readonly status: number;

  constructor(message: string, status = 401, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LLMAuthError';
    this.status = status;
  }
}

export class LLMParseError extends LLMError {
  /** Raw text from the LLM (for diagnostic logging). */
  public readonly raw?: string | undefined;

  constructor(message: string, raw?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LLMParseError';
    this.raw = raw;
  }
}
