import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../../../app';
import { prisma } from '../../../lib/prisma';
import { signToken } from '../../../lib/jwt';

const app = createApp();

async function makeUser(opts: { username: string; role: string; password?: string }) {
  return prisma.user.create({
    data: {
      username: opts.username,
      email: `${opts.username}@example.com`,
      role: opts.role,
      password_hash: await bcrypt.hash(opts.password ?? 'pw12345', 10),
    },
  });
}
function tokenFor(u: { id: string; username: string; role: string }) {
  return signToken({ sub: u.id, username: u.username, role: u.role as never });
}

describe('users routes (admin only)', () => {
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let operator: Awaited<ReturnType<typeof makeUser>>;
  let adminToken: string;
  let operatorToken: string;

  beforeEach(async () => {
    admin = await makeUser({ username: 'admin', role: 'admin' });
    operator = await makeUser({ username: 'op1', role: 'operator' });
    adminToken = tokenFor(admin);
    operatorToken = tokenFor(operator);
  });

  it('GET /api/users requires admin', async () => {
    const r1 = await request(app).get('/api/users');
    expect(r1.status).toBe(401);
    const r2 = await request(app).get('/api/users').set('Authorization', `Bearer ${operatorToken}`);
    expect(r2.status).toBe(403);
    const r3 = await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken}`);
    expect(r3.status).toBe(200);
    expect(Array.isArray(r3.body)).toBe(true);
    expect(r3.body.length).toBe(2);
    // password_hash must NOT leak
    for (const u of r3.body) expect(u.password_hash).toBeUndefined();
  });

  it('POST /api/users creates a new user (admin)', async () => {
    const r = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'newbie', email: 'newbie@example.com', password: 'newbie123', role: 'operator' });
    expect(r.status).toBe(201);
    expect(r.body.user_id).toBeTruthy();
    expect(r.body.username).toBe('newbie');
    expect(r.body.role).toBe('operator');
    const stored = await prisma.user.findUnique({ where: { username: 'newbie' } });
    expect(stored?.password_hash).toBeTruthy();
    expect(stored?.password_hash).not.toBe('newbie123');
  });

  it('POST /api/users returns 409 on duplicate username', async () => {
    const r = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'admin', email: 'a@x.com', password: 'pw12345', role: 'operator' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('USERNAME_TAKEN');
  });

  it('POST /api/users validates body', async () => {
    const r = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'ab' });
    expect(r.status).toBe(400);
  });

  it('PUT /api/users/:id/role updates role', async () => {
    const r = await request(app)
      .put(`/api/users/${operator.id}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'expert' });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('expert');
  });

  it('PUT /api/users/:id/role returns 404 when user is missing', async () => {
    const r = await request(app)
      .put('/api/users/00000000-0000-0000-0000-000000000000/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'expert' });
    expect(r.status).toBe(404);
  });

  it('DELETE /api/users/:id removes user', async () => {
    const r = await request(app)
      .delete(`/api/users/${operator.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    const after = await prisma.user.findUnique({ where: { id: operator.id } });
    expect(after).toBeNull();
  });

  it('DELETE /api/users/:id returns 409 when admin tries to delete self', async () => {
    const r = await request(app)
      .delete(`/api/users/${admin.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CANNOT_DELETE_SELF');
  });

  it('DELETE /api/users/:id returns 404 when user is missing', async () => {
    const r = await request(app)
      .delete('/api/users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(404);
  });
});
