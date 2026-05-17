import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../../../app';
import { prisma } from '../../../lib/prisma';
import { signToken } from '../../../lib/jwt';

const app = createApp();

async function makeUser(opts: { username: string; role: string }) {
  return prisma.user.create({
    data: {
      username: opts.username,
      email: `${opts.username}@example.com`,
      role: opts.role,
      password_hash: await bcrypt.hash('pw12345', 10),
    },
  });
}
function tokenFor(u: { id: string; username: string; role: string }) {
  return signToken({ sub: u.id, username: u.username, role: u.role as never });
}

describe('graphs routes', () => {
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let expert: Awaited<ReturnType<typeof makeUser>>;
  let operator: Awaited<ReturnType<typeof makeUser>>;
  let adminToken: string;
  let expertToken: string;
  let operatorToken: string;

  beforeEach(async () => {
    admin = await makeUser({ username: 'admin', role: 'admin' });
    expert = await makeUser({ username: 'expert1', role: 'expert' });
    operator = await makeUser({ username: 'op1', role: 'operator' });
    adminToken = tokenFor(admin);
    expertToken = tokenFor(expert);
    operatorToken = tokenFor(operator);
  });

  it('GET /api/graphs requires auth', async () => {
    const r = await request(app).get('/api/graphs');
    expect(r.status).toBe(401);
  });

  it('POST /api/graphs creates a graph (expert)', async () => {
    const r = await request(app)
      .post('/api/graphs')
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ graph_name: '基础护理', graph_type: 'course', subject: '护理学' });
    expect(r.status).toBe(201);
    expect(r.body.graph_id).toMatch(/^graph_/);
    expect(r.body.created_by).toBe(expert.id);
    expect(r.body.node_count).toBe(0);
  });

  it('POST /api/graphs returns 403 for operator', async () => {
    const r = await request(app)
      .post('/api/graphs')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ graph_name: 'X', graph_type: 'course' });
    expect(r.status).toBe(403);
  });

  it('POST /api/graphs validates body (400 on bad graph_type)', async () => {
    const r = await request(app)
      .post('/api/graphs')
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ graph_name: 'X', graph_type: 'NOPE' });
    expect(r.status).toBe(400);
  });

  it('GET /api/graphs lists previously-created graphs', async () => {
    await request(app)
      .post('/api/graphs')
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ graph_name: 'L1', graph_type: 'course' });
    const r = await request(app)
      .get('/api/graphs')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body[0].node_count).toBe(0);
  });

  it('GET /api/graphs/:id returns {graph, nodes, relations}', async () => {
    const created = await request(app)
      .post('/api/graphs')
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ graph_name: 'D1', graph_type: 'course' });
    const r = await request(app)
      .get(`/api/graphs/${created.body.graph_id}`)
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(r.status).toBe(200);
    expect(r.body.graph.graph_id).toBe(created.body.graph_id);
    expect(Array.isArray(r.body.nodes)).toBe(true);
    expect(Array.isArray(r.body.relations)).toBe(true);
  });

  it('GET /api/graphs/:id returns 404 for missing id', async () => {
    const r = await request(app)
      .get('/api/graphs/graph_missing')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(r.status).toBe(404);
  });

  it('PUT /api/graphs/:id updates allowed fields (admin)', async () => {
    const created = await request(app)
      .post('/api/graphs')
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ graph_name: 'P1', graph_type: 'course' });
    const r = await request(app)
      .put(`/api/graphs/${created.body.graph_id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ graph_name: 'P1-renamed', description: 'updated' });
    expect(r.status).toBe(200);
    expect(r.body.graph_name).toBe('P1-renamed');
    expect(r.body.description).toBe('updated');
  });

  it('PUT /api/graphs/:id is forbidden for operator', async () => {
    const created = await request(app)
      .post('/api/graphs')
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ graph_name: 'P2', graph_type: 'course' });
    const r = await request(app)
      .put(`/api/graphs/${created.body.graph_id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ graph_name: 'no' });
    expect(r.status).toBe(403);
  });

  it('DELETE /api/graphs/:id requires admin', async () => {
    const created = await request(app)
      .post('/api/graphs')
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ graph_name: 'X1', graph_type: 'course' });
    const expert403 = await request(app)
      .delete(`/api/graphs/${created.body.graph_id}`)
      .set('Authorization', `Bearer ${expertToken}`);
    expect(expert403.status).toBe(403);
    const ok = await request(app)
      .delete(`/api/graphs/${created.body.graph_id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    const after = await request(app)
      .get(`/api/graphs/${created.body.graph_id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(after.status).toBe(404);
  });

  it('GET /api/graphs/:id/export downloads JSON with attachment header', async () => {
    const created = await request(app)
      .post('/api/graphs')
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ graph_name: 'E1', graph_type: 'course' });
    const r = await request(app)
      .get(`/api/graphs/${created.body.graph_id}/export`)
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/attachment;/);
    const parsed = JSON.parse(r.text);
    expect(parsed.graph.graph_id).toBe(created.body.graph_id);
    expect(parsed.nodes).toEqual([]);
    expect(parsed.relations).toEqual([]);
  });
});
