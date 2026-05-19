/**
 * Routes tests — exercises auth, validation, 404, transient OpenAI failure
 * mapping, and the happy path end-to-end through SearchService.
 *
 * The OpenAI SDK is mocked to keep tests offline. Embeddings are seeded
 * directly via `$executeRaw` so we can verify ordering without depending
 * on a real model.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../../../app';
import { prisma } from '../../../lib/prisma';
import { signToken } from '../../../lib/jwt';
import { GraphService } from '../../graphs/graph.service';
import { NodeService } from '../../nodes/node.service';
import { EMBEDDING_DIM } from '../../../services/embedding/openai';

const createMock = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: (...args: unknown[]) => createMock(...args),
    },
  })),
}));

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

function unitVec(x: number, y: number): number[] {
  const v = new Array(EMBEDDING_DIM).fill(0);
  const m = Math.sqrt(x * x + y * y) || 1;
  v[0] = x / m;
  v[1] = y / m;
  return v;
}

async function setEmbedding(node_id: string, vec: number[]): Promise<void> {
  const lit = `[${vec.join(',')}]`;
  await prisma.$executeRaw`UPDATE nodes SET embedding = ${lit}::vector WHERE node_id = ${node_id}`;
}

describe('search routes', () => {
  let user: Awaited<ReturnType<typeof makeUser>>;
  let token: string;
  let graphId: string;
  let kpA: string;

  beforeEach(async () => {
    createMock.mockReset();
    user = await makeUser({ username: 'searcher', role: 'expert' });
    token = tokenFor(user);
    const g = await GraphService.create({
      graph_name: 'r-search',
      graph_type: 'course',
      created_by: user.id,
    });
    graphId = g.graph_id;
    const A = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'A',
      knowledge_type: '概念类',
    } as never);
    kpA = A!.node_id as string;
    await setEmbedding(kpA, unitVec(1, 0));
  });

  it('POST /api/graphs/:graph_id/search requires auth', async () => {
    const r = await request(app)
      .post(`/api/graphs/${graphId}/search`)
      .send({ q: 'hi' });
    expect(r.status).toBe(401);
  });

  it('returns 400 when q is missing', async () => {
    createMock.mockResolvedValue({ data: [{ embedding: unitVec(1, 0) }] });
    const r = await request(app)
      .post(`/api/graphs/${graphId}/search`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('validation_error');
  });

  it('returns 400 when q is too long', async () => {
    const r = await request(app)
      .post(`/api/graphs/${graphId}/search`)
      .set('Authorization', `Bearer ${token}`)
      .send({ q: 'a'.repeat(501) });
    expect(r.status).toBe(400);
  });

  it('returns 400 when k > 50', async () => {
    const r = await request(app)
      .post(`/api/graphs/${graphId}/search`)
      .set('Authorization', `Bearer ${token}`)
      .send({ q: 'x', k: 100 });
    expect(r.status).toBe(400);
  });

  it('returns 404 for unknown graph_id', async () => {
    const r = await request(app)
      .post(`/api/graphs/graph_nope/search`)
      .set('Authorization', `Bearer ${token}`)
      .send({ q: 'x' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('graph_not_found');
  });

  it('returns 200 with matches on the happy path', async () => {
    createMock.mockResolvedValue({ data: [{ embedding: unitVec(1, 0) }] });
    const r = await request(app)
      .post(`/api/graphs/${graphId}/search`)
      .set('Authorization', `Bearer ${token}`)
      .send({ q: 'hello', k: 5, include_neighbors: false });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.matches)).toBe(true);
    expect(r.body.matches.length).toBeGreaterThan(0);
    const top = r.body.matches[0];
    expect(top.node.node_id).toBe(kpA);
    expect(top.score).toBeCloseTo(1, 5);
  });

  it('maps transient OpenAI failure to 503 + Retry-After', async () => {
    const transient = Object.assign(new Error('rate-limited'), { status: 429 });
    createMock.mockRejectedValue(transient);
    const r = await request(app)
      .post(`/api/graphs/${graphId}/search`)
      .set('Authorization', `Bearer ${token}`)
      .send({ q: 'x' });
    expect(r.status).toBe(503);
    expect(r.headers['retry-after']).toBe('5');
    expect(r.body.error).toBe('embedding_service_unavailable');
  });

  it('lets non-transient failures bubble to 500', async () => {
    createMock.mockRejectedValue(new Error('totally unrelated'));
    const r = await request(app)
      .post(`/api/graphs/${graphId}/search`)
      .set('Authorization', `Bearer ${token}`)
      .send({ q: 'x' });
    expect(r.status).toBe(500);
  });
});
