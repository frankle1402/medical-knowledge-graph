import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { errorHandler } from '../errorHandler';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.get('/zod', (_req, _res, next) => {
    try {
      z.object({ a: z.string() }).parse({ a: 1 });
    } catch (e) {
      next(e);
    }
  });
  app.get('/p2002', (_req, _res, next) => {
    next({ code: 'P2002' });
  });
  app.get('/p2025', (_req, _res, next) => {
    next({ code: 'P2025' });
  });
  app.get('/http', (_req, _res, next) => {
    const e = Object.assign(new Error('boom'), { status: 418, code: 'TEAPOT' });
    next(e);
  });
  app.get('/plain', (_req, _res, next) => {
    next(new Error('plain'));
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  const app = makeApp();

  it('returns 400 with validation_error for ZodError', async () => {
    const r = await request(app).get('/zod');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('validation_error');
    expect(Array.isArray(r.body.issues)).toBe(true);
  });

  it('maps Prisma P2002 to 409 unique_violation', async () => {
    const r = await request(app).get('/p2002');
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('unique_violation');
  });

  it('maps Prisma P2025 to 404 not_found', async () => {
    const r = await request(app).get('/p2025');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('not_found');
  });

  it('honours custom status and code on errors', async () => {
    const r = await request(app).get('/http');
    expect(r.status).toBe(418);
    expect(r.body.error).toBe('boom');
    expect(r.body.code).toBe('TEAPOT');
  });

  it('falls back to 500 with the error message', async () => {
    const r = await request(app).get('/plain');
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('plain');
  });
});
