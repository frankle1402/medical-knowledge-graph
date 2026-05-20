import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requirePgBackend } from '../requirePgBackend';

describe('requirePgBackend', () => {
  const original = process.env.STORAGE_BACKEND;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.STORAGE_BACKEND;
    else process.env.STORAGE_BACKEND = original;
  });

  function makeApp() {
    const app = express();
    app.get('/protected', requirePgBackend, (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it('passes through when STORAGE_BACKEND=pg', async () => {
    process.env.STORAGE_BACKEND = 'pg';
    const res = await request(makeApp()).get('/protected');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns 503 + pg_backend_required when STORAGE_BACKEND=neo4j', async () => {
    process.env.STORAGE_BACKEND = 'neo4j';
    const res = await request(makeApp()).get('/protected');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('pg_backend_required');
    expect(res.body.hint).toMatch(/STORAGE_BACKEND=pg/);
  });

  it('returns 503 when STORAGE_BACKEND is unset (default neo4j)', async () => {
    delete process.env.STORAGE_BACKEND;
    const res = await request(makeApp()).get('/protected');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('pg_backend_required');
  });
});
