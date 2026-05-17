import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../../../app';
import { prisma } from '../../../lib/prisma';
import { signToken } from '../../../lib/jwt';

const app = createApp();

async function makeUser(overrides: Partial<{ username: string; email: string; role: string; password: string; is_active: boolean }> = {}) {
  const data = {
    username: overrides.username ?? 'admin',
    email: overrides.email ?? 'admin@example.com',
    role: overrides.role ?? 'admin',
    password: overrides.password ?? 'admin123',
    is_active: overrides.is_active ?? true,
  };
  return prisma.user.create({
    data: {
      username: data.username,
      email: data.email,
      role: data.role,
      is_active: data.is_active,
      password_hash: await bcrypt.hash(data.password, 10),
    },
  });
}

describe('auth routes', () => {
  beforeEach(async () => {
    await makeUser();
  });

  it('POST /api/auth/login returns token + user on valid credentials', async () => {
    const r = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe('string');
    expect(r.body.user.username).toBe('admin');
    expect(r.body.user.role).toBe('admin');
  });

  it('POST /api/auth/login returns 401 on wrong password', async () => {
    const r = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('POST /api/auth/login returns 401 on unknown user', async () => {
    const r = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nope', password: 'whatever' });
    expect(r.status).toBe(401);
  });

  it('POST /api/auth/login rejects deactivated users', async () => {
    await prisma.user.update({ where: { username: 'admin' }, data: { is_active: false } });
    const r = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    expect(r.status).toBe(401);
  });

  it('POST /api/auth/login validates the body', async () => {
    const r = await request(app).post('/api/auth/login').send({});
    expect(r.status).toBe(400);
  });

  it('GET /api/auth/me returns 401 without token', async () => {
    const r = await request(app).get('/api/auth/me');
    expect(r.status).toBe(401);
  });

  it('GET /api/auth/me returns the current user', async () => {
    const u = await prisma.user.findUnique({ where: { username: 'admin' } });
    const token = signToken({ sub: u!.id, username: u!.username, role: 'admin' });
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.username).toBe('admin');
    expect(r.body.role).toBe('admin');
  });

  it('GET /api/auth/me returns 404 when user is deleted', async () => {
    const token = signToken({ sub: '00000000-0000-0000-0000-000000000000', role: 'admin' });
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(404);
  });

  it('POST /api/auth/logout requires auth and returns ok', async () => {
    const u = await prisma.user.findUnique({ where: { username: 'admin' } });
    const token = signToken({ sub: u!.id, role: 'admin' });
    const r = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});
