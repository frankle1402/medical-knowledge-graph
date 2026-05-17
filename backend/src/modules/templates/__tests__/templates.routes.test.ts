import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../../../app';
import { prisma } from '../../../lib/prisma';
import { signToken } from '../../../lib/jwt';

const app = createApp();

const baseTemplate = {
  name: 'Concept extractor',
  description: 'extract concepts',
  variables: [
    { key: 'topic', label: '主题', type: 'text', required: true },
  ],
  system_prompt: 'You are a helpful extractor.',
  user_prompt_template: 'Extract concepts about {{topic}}.',
};

async function setupUsers() {
  const admin = await prisma.user.create({
    data: {
      username: 'admin', email: 'a@x.com', role: 'admin',
      password_hash: await bcrypt.hash('pw12345', 10),
    },
  });
  const expert = await prisma.user.create({
    data: {
      username: 'expert', email: 'e@x.com', role: 'expert',
      password_hash: await bcrypt.hash('pw12345', 10),
    },
  });
  const operator = await prisma.user.create({
    data: {
      username: 'op', email: 'o@x.com', role: 'operator',
      password_hash: await bcrypt.hash('pw12345', 10),
    },
  });
  return {
    admin, expert, operator,
    adminToken: signToken({ sub: admin.id, username: admin.username, role: 'admin' }),
    expertToken: signToken({ sub: expert.id, username: expert.username, role: 'expert' }),
    operatorToken: signToken({ sub: operator.id, username: operator.username, role: 'operator' }),
  };
}

describe('templates routes', () => {
  let ctx: Awaited<ReturnType<typeof setupUsers>>;
  beforeEach(async () => {
    ctx = await setupUsers();
  });

  it('GET /api/templates requires auth', async () => {
    const r = await request(app).get('/api/templates');
    expect(r.status).toBe(401);
  });

  it('admin can create a template', async () => {
    const r = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send(baseTemplate);
    expect(r.status).toBe(201);
    expect(r.body.id).toBeTruthy();
    expect(r.body.name).toBe('Concept extractor');
    expect(r.body.is_active).toBe(true);
  });

  it('non-admin (operator/expert) cannot create', async () => {
    const r1 = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${ctx.operatorToken}`)
      .send(baseTemplate);
    expect(r1.status).toBe(403);
    const r2 = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${ctx.expertToken}`)
      .send(baseTemplate);
    expect(r2.status).toBe(403);
  });

  it('GET /api/templates lists only active and non-deleted templates', async () => {
    const c = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send(baseTemplate);
    const id = c.body.id;
    // soft delete
    await request(app)
      .delete(`/api/templates/${id}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    const list = await request(app).get('/api/templates').set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.find((t: { id: string }) => t.id === id)).toBeUndefined();
  });

  it('GET /api/templates/:id returns 404 after soft-delete', async () => {
    const c = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send(baseTemplate);
    const id = c.body.id;
    await request(app).delete(`/api/templates/${id}`).set('Authorization', `Bearer ${ctx.adminToken}`);
    const got = await request(app).get(`/api/templates/${id}`).set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(got.status).toBe(404);
  });

  it('soft-delete sets is_active=false and deleted_at', async () => {
    const c = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send(baseTemplate);
    const id = c.body.id;
    const r = await request(app)
      .delete(`/api/templates/${id}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(r.status).toBe(200);
    const row = await prisma.promptTemplate.findUnique({ where: { id } });
    expect(row?.is_active).toBe(false);
    expect(row?.deleted_at).toBeTruthy();
  });

  it('PUT /api/templates/:id updates fields', async () => {
    const c = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send(baseTemplate);
    const r = await request(app)
      .put(`/api/templates/${c.body.id}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: 'Renamed' });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Renamed');
  });

  it('PUT/DELETE return 404 for missing id', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';
    const u = await request(app).put(`/api/templates/${missing}`).set('Authorization', `Bearer ${ctx.adminToken}`).send({ name: 'x' });
    expect(u.status).toBe(404);
    const d = await request(app).delete(`/api/templates/${missing}`).set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(d.status).toBe(404);
  });
});
