import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireAuth, requireRole } from '../auth';
import { errorHandler } from '../errorHandler';
import { signToken } from '../../lib/jwt';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.get('/protected', requireAuth, (req, res) => {
    res.json({ id: req.user!.id, role: req.user!.role });
  });
  app.get('/admin-only', requireAuth, requireRole('admin'), (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/admin-or-expert', requireAuth, requireRole(['admin', 'expert']), (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/role-without-auth', requireRole('admin'), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe('requireAuth', () => {
  const app = makeApp();
  it('returns 401 when Authorization header is missing', async () => {
    const r = await request(app).get('/protected');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('missing_token');
  });

  it('returns 401 when header does not start with Bearer', async () => {
    const r = await request(app).get('/protected').set('Authorization', 'Basic abc');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('missing_token');
  });

  it('returns 401 when token is invalid', async () => {
    const r = await request(app).get('/protected').set('Authorization', 'Bearer not.a.token');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('invalid_token');
  });

  it('passes when token is valid and exposes id/role on req.user', async () => {
    const token = signToken({ id: 'u-1', role: 'admin' });
    const r = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: 'u-1', role: 'admin' });
  });
});

describe('requireRole', () => {
  const app = makeApp();
  it('returns 401 when called without prior auth', async () => {
    const r = await request(app).get('/role-without-auth');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('unauthenticated');
  });

  it('returns 403 when role does not match', async () => {
    const token = signToken({ id: 'u-2', role: 'operator' });
    const r = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('forbidden');
  });

  it('passes when role matches (variadic form)', async () => {
    const token = signToken({ id: 'u-3', role: 'admin' });
    const r = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
  });

  it('passes when role matches (array form)', async () => {
    const token = signToken({ id: 'u-4', role: 'expert' });
    const r = await request(app).get('/admin-or-expert').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
  });

  it('rejects when role is none of the allowed (array form)', async () => {
    const token = signToken({ id: 'u-5', role: 'operator' });
    const r = await request(app).get('/admin-or-expert').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(403);
  });
});
