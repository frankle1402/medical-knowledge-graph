import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../../../app';
import { prisma } from '../../../lib/prisma';
import { signToken } from '../../../lib/jwt';

const app = createApp();

async function tokens() {
  const admin = await prisma.user.create({
    data: { username: 'admin', email: 'a@x.com', role: 'admin', password_hash: await bcrypt.hash('pw', 10) },
  });
  const expert = await prisma.user.create({
    data: { username: 'expert', email: 'e@x.com', role: 'expert', password_hash: await bcrypt.hash('pw', 10) },
  });
  const operator = await prisma.user.create({
    data: { username: 'op', email: 'o@x.com', role: 'operator', password_hash: await bcrypt.hash('pw', 10) },
  });
  return {
    admin: signToken({ sub: admin.id, username: admin.username, role: 'admin' }),
    expert: signToken({ sub: expert.id, username: expert.username, role: 'expert' }),
    operator: signToken({ sub: operator.id, username: operator.username, role: 'operator' }),
    adminId: admin.id,
  };
}

describe('system routes', () => {
  let t: Awaited<ReturnType<typeof tokens>>;
  beforeEach(async () => {
    t = await tokens();
  });

  it('GET /api/system/llm requires admin', async () => {
    const r1 = await request(app).get('/api/system/llm');
    expect(r1.status).toBe(401);
    const r2 = await request(app).get('/api/system/llm').set('Authorization', `Bearer ${t.operator}`);
    expect(r2.status).toBe(403);
    const r3 = await request(app).get('/api/system/llm').set('Authorization', `Bearer ${t.admin}`);
    expect(r3.status).toBe(200);
    expect(typeof r3.body.base_url).toBe('string');
    expect(typeof r3.body.model).toBe('string');
    expect(typeof r3.body.api_key_set).toBe('boolean');
  });

  it('GET /api/system/ai-logs returns recent logs (admin or expert)', async () => {
    await prisma.aiGenerationLog.create({
      data: { graph_id: 'g-1', status: 'success', nodes_created: 1 },
    });
    await prisma.aiGenerationLog.create({
      data: { graph_id: 'g-2', status: 'failed', error_msg: 'boom' },
    });
    const r = await request(app).get('/api/system/ai-logs').set('Authorization', `Bearer ${t.expert}`);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.items.length).toBe(2);
  });

  it('GET /api/system/ai-logs filters by graph_id', async () => {
    await prisma.aiGenerationLog.create({ data: { graph_id: 'g-A', status: 'success' } });
    await prisma.aiGenerationLog.create({ data: { graph_id: 'g-B', status: 'success' } });
    const r = await request(app)
      .get('/api/system/ai-logs?graph_id=g-A')
      .set('Authorization', `Bearer ${t.admin}`);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.items[0].graph_id).toBe('g-A');
  });

  it('GET /api/system/ai-logs forbids operator', async () => {
    const r = await request(app).get('/api/system/ai-logs').set('Authorization', `Bearer ${t.operator}`);
    expect(r.status).toBe(403);
  });

  it('GET /healthz returns ok', async () => {
    const r = await request(app).get('/healthz');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('GET /api/docs serves swagger UI', async () => {
    const r = await request(app).get('/api/docs/');
    // swagger-ui-express returns HTML on the index
    expect([200, 301, 302]).toContain(r.status);
  });
});
