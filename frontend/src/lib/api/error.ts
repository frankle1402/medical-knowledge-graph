/**
 * API client error class — typed wrapper around axios / fetch errors.
 * Agent-E will reuse this same error class for consistent UX.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string | undefined;
  public readonly details: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static fromUnknown(err: unknown): ApiError {
    if (err instanceof ApiError) return err;
    if (err instanceof Error) return new ApiError(err.message, 0, 'NETWORK_ERROR');
    return new ApiError('Unknown error', 0, 'UNKNOWN');
  }
}
