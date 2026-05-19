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

async function seedChain(): Promise<void> {
  await prisma.graph.create({
    data: { graph_id: 'G1', graph_name: 't', graph_type: 'curriculum' },
  });
  for (const id of ['A', 'B', 'C', 'D']) {
    await prisma.node.create({
      data: {
        node_id: id,
        graph_id: 'G1',
        node_type: 'knowledge_point',
        name: id,
      },
    });
  }
  for (const [s, t] of [
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'D'],
  ]) {
    await prisma.relation.create({
      data: {
        graph_id: 'G1',
        source_id: s as string,
        target_id: t as string,
        relation_type: '前置',
      },
    });
  }
}

describe('learning routes', () => {
  let operatorToken: string;

  beforeEach(async () => {
    const op = await makeUser({ username: 'op1', role: 'operator' });
    operatorToken = tokenFor(op);
  });

  it('GET /api/nodes/:node_id/learning-path requires auth', async () => {
    const r = await request(app).get('/api/nodes/anything/learning-path');
    expect(r.status).toBe(401);
  });

  it('GET /api/nodes/:node_id/learning-path returns the path shape', async () => {
    await seedChain();
    const r = await request(app)
      .get('/api/nodes/D/learning-path?depth=5')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(r.status).toBe(200);
    expect(r.body.target).toEqual({ node_id: 'D', name: 'D' });
    expect(Array.isArray(r.body.path)).toBe(true);
    expect(r.body.path.map((s: { node_id: string }) => s.node_id)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(r.body.path[0]).toMatchObject({
      node_id: 'A',
      name: 'A',
      depth: 3,
      via: '前置',
    });
  });

  it('GET /api/nodes/:node_id/learning-path 404 for unknown node', async () => {
    const r = await request(app)
      .get('/api/nodes/NOPE/learning-path')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(r.status).toBe(404);
  });

  it('GET /api/nodes/:node_id/learning-path 400 for out-of-range depth', async () => {
    await seedChain();
    const r = await request(app)
      .get('/api/nodes/D/learning-path?depth=99')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(r.status).toBe(400);
  });

  it('POST /api/graphs/:graph_id/knowledge-gap requires auth', async () => {
    const r = await request(app)
      .post('/api/graphs/G1/knowledge-gap')
      .send({ mastered: [], targets: ['D'] });
    expect(r.status).toBe(401);
  });

  it('POST /api/graphs/:graph_id/knowledge-gap returns gaps array', async () => {
    await seedChain();
    const r = await request(app)
      .post('/api/graphs/G1/knowledge-gap')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ mastered: ['A'], targets: ['D'] });
    expect(r.status).toBe(200);
    const ids = r.body.gaps.map((g: { node_id: string }) => g.node_id).sort();
    expect(ids).toEqual(['B', 'C']);
    expect(r.body.gaps[0].blocking).toEqual(['D']);
  });

  it('POST /api/graphs/:graph_id/knowledge-gap 400 when targets missing', async () => {
    const r = await request(app)
      .post('/api/graphs/G1/knowledge-gap')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ mastered: [] });
    expect(r.status).toBe(400);
  });

  it('GET /api/graphs/:graph_id/synonym-candidates requires auth', async () => {
    const r = await request(app).get(
      '/api/graphs/G1/synonym-candidates?threshold=0.92',
    );
    expect(r.status).toBe(401);
  });

  it('GET /api/graphs/:graph_id/synonym-candidates 503 when no embeddings yet', async () => {
    await prisma.graph.create({
      data: { graph_id: 'G_EMPTY', graph_name: 'x', graph_type: 'curriculum' },
    });
    await prisma.node.create({
      data: {
        node_id: 'NN1',
        graph_id: 'G_EMPTY',
        node_type: 'knowledge_point',
        name: 'NN1',
      },
    });
    const r = await request(app)
      .get('/api/graphs/G_EMPTY/synonym-candidates')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('embeddings_not_ready');
  });

  it('GET /api/graphs/:graph_id/synonym-candidates 400 on out-of-range threshold', async () => {
    const r = await request(app)
      .get('/api/graphs/G1/synonym-candidates?threshold=0.5')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(r.status).toBe(400);
  });

  it('GET /api/graphs/:graph_id/synonym-candidates returns candidates with embeddings', async () => {
    // Seed two near-identical embeddings so we get one candidate pair.
    await prisma.graph.create({
      data: { graph_id: 'GE', graph_name: 'embed', graph_type: 'curriculum' },
    });
    for (const id of ['M1', 'M2']) {
      await prisma.node.create({
        data: {
          node_id: id,
          graph_id: 'GE',
          node_type: 'knowledge_point',
          name: id,
        },
      });
    }
    const dim = 1536;
    const lit = (head: number[]) => {
      const arr = new Array(dim).fill(0);
      for (let i = 0; i < head.length; i++) arr[i] = head[i];
      const n = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
      if (n > 0) for (let i = 0; i < dim; i++) arr[i] = arr[i] / n;
      return `[${arr.join(',')}]`;
    };
    await prisma.$executeRawUnsafe(
      'UPDATE nodes SET embedding = $1::vector WHERE node_id = $2',
      lit([1, 0.01, 0]),
      'M1',
    );
    await prisma.$executeRawUnsafe(
      'UPDATE nodes SET embedding = $1::vector WHERE node_id = $2',
      lit([1, 0.02, 0]),
      'M2',
    );

    const r = await request(app)
      .get('/api/graphs/GE/synonym-candidates?threshold=0.9')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.candidates)).toBe(true);
    expect(r.body.candidates.length).toBeGreaterThan(0);
    const first = r.body.candidates[0];
    expect(first.a.node_id).toBe('M1');
    expect(first.b.node_id).toBe('M2');
    expect(first.score).toBeGreaterThan(0.9);
  });
});
