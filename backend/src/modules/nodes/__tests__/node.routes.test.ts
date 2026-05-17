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

describe('node + relation routes (HTTP)', () => {
  let expertToken: string;
  let operatorToken: string;
  let graphId: string;

  beforeEach(async () => {
    const expert = await makeUser({ username: 'expert', role: 'expert' });
    const operator = await makeUser({ username: 'operator', role: 'operator' });
    expertToken = tokenFor(expert);
    operatorToken = tokenFor(operator);

    const r = await request(app)
      .post('/api/graphs')
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ graph_name: 'http-test', graph_type: 'course' });
    graphId = r.body.graph_id;
  });

  it('POST /api/graphs/:id/nodes creates a node (expert)', async () => {
    const r = await request(app)
      .post(`/api/graphs/${graphId}/nodes`)
      .set('Authorization', `Bearer ${expertToken}`)
      .send({
        node_type: 'knowledge_point',
        name: '心率',
        knowledge_type: '概念类',
      });
    expect(r.status).toBe(201);
    expect(r.body.node_id).toMatch(/^KP_/);
    expect(r.body.status).toBe('approved');
  });

  it('POST /api/graphs/:id/nodes is forbidden for operator', async () => {
    const r = await request(app)
      .post(`/api/graphs/${graphId}/nodes`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        node_type: 'knowledge_point',
        name: 'X',
        knowledge_type: '概念类',
      });
    expect(r.status).toBe(403);
  });

  it('GET /api/graphs/:id/nodes returns paginated list', async () => {
    await request(app)
      .post(`/api/graphs/${graphId}/nodes`)
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ node_type: 'knowledge_point', name: 'A', knowledge_type: '概念类' });
    await request(app)
      .post(`/api/graphs/${graphId}/nodes`)
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ node_type: 'knowledge_point', name: 'B', knowledge_type: '概念类' });

    const r = await request(app)
      .get(`/api/graphs/${graphId}/nodes`)
      .query({ skip: 0, limit: 1 })
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBe(1);
    expect(r.body.total).toBe(2);
  });

  it('PUT /api/nodes/:id allows expert; operator gets 403', async () => {
    const created = await request(app)
      .post(`/api/graphs/${graphId}/nodes`)
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ node_type: 'knowledge_point', name: 'P', knowledge_type: '概念类' });
    const nodeId = created.body.node_id;

    const ok = await request(app)
      .put(`/api/nodes/${nodeId}`)
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ description: 'updated' });
    expect(ok.status).toBe(200);
    expect(ok.body.description).toBe('updated');

    const forbidden = await request(app)
      .put(`/api/nodes/${nodeId}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ description: 'no' });
    expect(forbidden.status).toBe(403);
  });

  it('POST /api/nodes/batch-approve flips many nodes to approved', async () => {
    const a = await request(app)
      .post(`/api/graphs/${graphId}/nodes`)
      .set('Authorization', `Bearer ${expertToken}`)
      .send({
        node_type: 'knowledge_point',
        name: 'A',
        knowledge_type: '概念类',
        status: 'candidate',
      });
    const b = await request(app)
      .post(`/api/graphs/${graphId}/nodes`)
      .set('Authorization', `Bearer ${expertToken}`)
      .send({
        node_type: 'knowledge_point',
        name: 'B',
        knowledge_type: '概念类',
        status: 'candidate',
      });
    const r = await request(app)
      .post('/api/nodes/batch-approve')
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ node_ids: [a.body.node_id, b.body.node_id] });
    expect(r.status).toBe(200);
    expect(r.body.updated).toBe(2);
  });

  it('relation flow: create, list, update, delete', async () => {
    const a = await request(app)
      .post(`/api/graphs/${graphId}/nodes`)
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ node_type: 'knowledge_point', name: 'A', knowledge_type: '概念类' });
    const b = await request(app)
      .post(`/api/graphs/${graphId}/nodes`)
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ node_type: 'knowledge_point', name: 'B', knowledge_type: '概念类' });

    const created = await request(app)
      .post(`/api/graphs/${graphId}/relations`)
      .set('Authorization', `Bearer ${expertToken}`)
      .send({
        source_id: a.body.node_id,
        target_id: b.body.node_id,
        relation_type: 'PREREQUISITE_OF',
      });
    expect(created.status).toBe(201);
    expect(created.body.relation_type).toBe('PREREQUISITE_OF');

    const list = await request(app)
      .get(`/api/graphs/${graphId}/relations`)
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);

    const updated = await request(app)
      .put(`/api/relations/${created.body.relation_id}`)
      .set('Authorization', `Bearer ${expertToken}`)
      .send({ description: 'note' });
    expect(updated.status).toBe(200);
    expect(updated.body.description).toBe('note');

    const removed = await request(app)
      .delete(`/api/relations/${created.body.relation_id}`)
      .set('Authorization', `Bearer ${expertToken}`);
    expect(removed.status).toBe(200);
  });
});
