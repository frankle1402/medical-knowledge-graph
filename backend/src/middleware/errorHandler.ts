import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';

export interface HttpError extends Error {
  status?: number;
  code?: string;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'validation_error', issues: err.issues });
    return;
  }

  // Prisma known error codes
  if ((err as { code?: string })?.code === 'P2002') {
    res.status(409).json({ error: 'unique_violation', code: 'UNIQUE_VIOLATION' });
    return;
  }
  if ((err as { code?: string })?.code === 'P2025') {
    res.status(404).json({ error: 'not_found', code: 'NOT_FOUND' });
    return;
  }

  const httpErr = err as HttpError;
  const status = httpErr.status ?? 500;
  if (status >= 500) {
    logger.error({ err }, 'unhandled error');
  }
  const body: Record<string, unknown> = { error: httpErr.message ?? 'internal_error' };
  if (httpErr.code) body.code = httpErr.code;
  res.status(status).json(body);
};
