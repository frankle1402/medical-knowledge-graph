/**
 * Integration tests for /api/ai/* endpoints (Agent-C back-half).
 *
 * Strategy:
 * - Use supertest against the assembled Express app.
 * - Mock the LLM by stubbing global `fetch` (orchestrator's chatCompletion
 *   uses fetch under the hood — no real OpenAI traffic).
 * - Mock Agent-B's NodeService / RelationService methods with vi.spyOn —
 *   the real implementations require a running Neo4j (port 7687) which is
 *   intentionally absent from the test environment.
 * - Postgres (templates, ai_generation_logs) is real because vitest's
 *   global setup runs `prisma migrate deploy` against the test database.
 *
 * Coverage:
 *   - POST /api/ai/generate : auth, role guard, template lookup, kicks off
 *     orchestrator + persists job row, returns 202 with status='running'
 *   - GET  /api/ai/jobs/:id : 404 when missing, returns log row + output
 *   - POST /api/ai/jobs/:id/approve     : bulkUpdateStatusByIds path
 *   - POST /api/ai/jobs/:id/approve-all : bulkUpdateStatusByJob path
 *   - POST /api/ai/jobs/:id/reject-all  : bulkDeleteByJob path
 *   - 409 JOB_NOT_SUCCEEDED guard
 *   - role rejection (operator cannot approve / reject)
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  afterAll,
} from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';

import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { signToken } from '../../lib/jwt';
import { NodeService } from '../../modules/nodes/node.service';
import { RelationService } from '../../modules/relations/relation.service';
import { GraphService } from '../../modules/graphs/graph.service';

const app = createApp();

const SAMPLE_LLM_OUTPUT = {
  graph_name: '静脉输液与输血',
  nodes: [
    {
      node_id: 'KP_001',
      node_type: 'knowledge_point',
      name: '静脉输液概念',
      knowledge_type: '概念类',
    },
    {
      node_id: 'KP_002',
      node_type: 'knowledge_point',
      name: '静脉输液目的',
      knowledge_type: '目的类',
    },
  ],
  relations: [
    {
      source_id: 'KP_001',
      target_id: 'KP_002',
      relation_type: 'PREREQUISITE_OF',
    },
  ],
};

function mockFetchOnce(payload: unknown) {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: { content: JSON.stringify(payload) },
            finish_reason: 'stop',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function setupUsers() {
  const admin = await prisma.user.create({
    data: {
      username: 'admin',
      email: 'a@x.com',
      role: 'admin',
      password_hash: await bcrypt.hash('pw12345', 10),
    },
  });
  const expert = await prisma.user.create({
    data: {
      username: 'expert',
      email: 'e@x.com',
      role: 'expert',
      password_hash: await bcrypt.hash('pw12345', 10),
    },
  });
  const operator = await prisma.user.create({
    data: {
      username: 'op',
      email: 'o@x.com',
      role: 'operator',
      password_hash: await bcrypt.hash('pw12345', 10),
    },
  });
  return {
    admin,
    expert,
    operator,
    adminToken: signToken({
      sub: admin.id,
      username: admin.username,
      role: 'admin',
    }),
    expertToken: signToken({
      sub: expert.id,
      username: expert.username,
      role: 'expert',
    }),
    operatorToken: signToken({
      sub: operator.id,
      username: operator.username,
      role: 'operator',
    }),
  };
}

async function createTemplate(createdBy: string) {
  const t = await prisma.promptTemplate.create({
    data: {
      name: 'IV-extractor',
      description: '抽取静脉输液知识点',
      variables: [
        { key: 'course_name', label: '课程', type: 'text', required: true },
        { key: 'chapter_name', label: '章节', type: 'text', required: true },
        {
          key: 'depth',
          label: '详细程度',
          type: 'select',
          options: ['基础', '标准', '详细'],
          required: true,
        },
      ],
      system_prompt: '你是医学知识图谱专家。',
      user_prompt_template:
        '请为《{{course_name}}》中的「{{chapter_name}}」构建图谱。详细程度：{{depth}}',
      created_by: createdBy,
    },
  });
  return t;
}

async function createSucceededJob(opts: {
  graphId?: string;
  templateId: string;
  userId: string;
  status?: 'success' | 'running' | 'failed';
}) {
  return prisma.aiGenerationLog.create({
    data: {
      graph_id: opts.graphId ?? 'graph_test_x',
      template_id: opts.templateId,
      user_id: opts.userId,
      status: opts.status ?? 'success',
      prompt_used: 'rendered prompt',
      llm_response: JSON.stringify(SAMPLE_LLM_OUTPUT),
      nodes_created: 2,
      relations_created: 1,
    },
  });
}

beforeEach(() => {
  // Avoid touching real Neo4j: the orchestrator instance inside ai.routes
  // already references NodeService/RelationService by reference, so we
  // override the methods rather than the imports. Agent-B's bulk-create
  // entry points are `createBatch` (nodes) and `createBatch` (relations).
  vi.spyOn(NodeService, 'createBatch').mockResolvedValue([
    { node_id: 'KP_001' },
    { node_id: 'KP_002' },
  ] as never);
  vi.spyOn(RelationService, 'createBatch').mockResolvedValue(1);
  // resolveGraphId path: when client omits graph_id we'd hit GraphService.create
  // (which talks to Neo4j). Stub that too.
  vi.spyOn(GraphService, 'create').mockResolvedValue({
    graph_id: 'graph_auto_1',
    graph_name: 'AI-IV-extractor-x',
    graph_type: 'course',
    status: 'active',
    node_count: 0,
    relation_count: 0,
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/ai/generate', () => {
  it('requires auth', async () => {
    const r = await request(app).post('/api/ai/generate').send({});
    expect(r.status).toBe(401);
  });

  it('rejects unknown template_id with 404', async () => {
    const ctx = await setupUsers();
    mockFetchOnce(SAMPLE_LLM_OUTPUT);
    const r = await request(app)
      .post('/api/ai/generate')
      .set('Authorization', `Bearer ${ctx.operatorToken}`)
      .send({
        template_id: '00000000-0000-0000-0000-000000000000',
        variables: { course_name: 'a', chapter_name: 'b', depth: '标准' },
      });
    expect(r.status).toBe(404);
  });

  it('operator can start a generation job', async () => {
    const ctx = await setupUsers();
    const tpl = await createTemplate(ctx.admin.id);
    mockFetchOnce(SAMPLE_LLM_OUTPUT);

    const r = await request(app)
      .post('/api/ai/generate')
      .set('Authorization', `Bearer ${ctx.operatorToken}`)
      .send({
        template_id: tpl.id,
        variables: { course_name: '基础护理学', chapter_name: '静脉输液', depth: '标准' },
        graph_id: 'graph_test_x',
      });

    expect(r.status).toBe(202);
    expect(r.body.job_id).toBeTruthy();
    expect(r.body.status).toBe('running');

    // The fire-and-forget background promise persists status=success eventually.
    // Poll until the row is updated (or fail after a short timeout).
    let row = await prisma.aiGenerationLog.findUnique({
      where: { id: r.body.job_id },
    });
    for (let i = 0; i < 50 && row?.status === 'running'; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      row = await prisma.aiGenerationLog.findUnique({
        where: { id: r.body.job_id },
      });
    }
    expect(row?.status).toBe('success');
    expect(row?.nodes_created).toBe(2);
  });

  it('rejects invalid body with 400', async () => {
    const ctx = await setupUsers();
    const r = await request(app)
      .post('/api/ai/generate')
      .set('Authorization', `Bearer ${ctx.operatorToken}`)
      .send({ variables: {} }); // missing template_id
    expect(r.status).toBe(400);
  });
});

describe('GET /api/ai/jobs/:jobId', () => {
  it('requires auth', async () => {
    const r = await request(app).get('/api/ai/jobs/x');
    expect(r.status).toBe(401);
  });

  it('returns 404 for unknown job', async () => {
    const ctx = await setupUsers();
    const r = await request(app)
      .get('/api/ai/jobs/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${ctx.operatorToken}`);
    expect(r.status).toBe(404);
  });

  it('returns AIJob payload for a succeeded job', async () => {
    const ctx = await setupUsers();
    const tpl = await createTemplate(ctx.admin.id);
    const job = await createSucceededJob({
      templateId: tpl.id,
      userId: ctx.admin.id,
    });
    // listByAiJob would hit Neo4j; stub.
    vi.spyOn(NodeService, 'listByAiJob').mockResolvedValue([
      { node_id: 'KP_001', node_type: 'knowledge_point', name: '静脉输液概念' },
    ] as never);

    const r = await request(app)
      .get(`/api/ai/jobs/${job.id}`)
      .set('Authorization', `Bearer ${ctx.operatorToken}`);
    expect(r.status).toBe(200);
    expect(r.body.job_id).toBe(job.id);
    expect(r.body.status).toBe('success');
    expect(r.body.graph_id).toBe('graph_test_x');
    expect(r.body.output?.nodes).toHaveLength(1);
  });

  it('returns running job without output', async () => {
    const ctx = await setupUsers();
    const tpl = await createTemplate(ctx.admin.id);
    const job = await createSucceededJob({
      templateId: tpl.id,
      userId: ctx.admin.id,
      status: 'running',
    });

    const r = await request(app)
      .get(`/api/ai/jobs/${job.id}`)
      .set('Authorization', `Bearer ${ctx.operatorToken}`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('running');
    expect(r.body.output).toBeUndefined();
  });
});

describe('POST /api/ai/jobs/:jobId/approve-all', () => {
  it('expert can approve-all', async () => {
    const ctx = await setupUsers();
    const tpl = await createTemplate(ctx.admin.id);
    const job = await createSucceededJob({
      templateId: tpl.id,
      userId: ctx.admin.id,
    });
    const nSpy = vi
      .spyOn(NodeService, 'bulkUpdateStatusByJob')
      .mockResolvedValue(3);
    const rSpy = vi
      .spyOn(RelationService, 'bulkUpdateStatusByJob')
      .mockResolvedValue(2);

    const r = await request(app)
      .post(`/api/ai/jobs/${job.id}/approve-all`)
      .set('Authorization', `Bearer ${ctx.expertToken}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, nodes: 3, relations: 2 });
    expect(nSpy).toHaveBeenCalledWith('graph_test_x', job.id, 'approved');
    expect(rSpy).toHaveBeenCalledWith('graph_test_x', job.id, 'approved');
  });

  it('admin can approve-all', async () => {
    const ctx = await setupUsers();
    const tpl = await createTemplate(ctx.admin.id);
    const job = await createSucceededJob({
      templateId: tpl.id,
      userId: ctx.admin.id,
    });
    vi.spyOn(NodeService, 'bulkUpdateStatusByJob').mockResolvedValue(3);
    vi.spyOn(RelationService, 'bulkUpdateStatusByJob').mockResolvedValue(2);

    const r = await request(app)
      .post(`/api/ai/jobs/${job.id}/approve-all`)
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(r.status).toBe(200);
  });

  it('operator is forbidden (403)', async () => {
    const ctx = await setupUsers();
    const tpl = await createTemplate(ctx.admin.id);
    const job = await createSucceededJob({
      templateId: tpl.id,
      userId: ctx.admin.id,
    });
    const r = await request(app)
      .post(`/api/ai/jobs/${job.id}/approve-all`)
      .set('Authorization', `Bearer ${ctx.operatorToken}`);
    expect(r.status).toBe(403);
  });

  it('returns 409 JOB_NOT_SUCCEEDED for running job', async () => {
    const ctx = await setupUsers();
    const tpl = await createTemplate(ctx.admin.id);
    const job = await createSucceededJob({
      templateId: tpl.id,
      userId: ctx.admin.id,
      status: 'running',
    });
    const r = await request(app)
      .post(`/api/ai/jobs/${job.id}/approve-all`)
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('JOB_NOT_SUCCEEDED');
  });

  it('returns 404 for missing job', async () => {
    const ctx = await setupUsers();
    const r = await request(app)
      .post('/api/ai/jobs/00000000-0000-0000-0000-000000000000/approve-all')
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(r.status).toBe(404);
  });
});

describe('POST /api/ai/jobs/:jobId/approve', () => {
  it('forwards node_ids and relation_ids to services', async () => {
    const ctx = await setupUsers();
    const tpl = await createTemplate(ctx.admin.id);
    const job = await createSucceededJob({
      templateId: tpl.id,
      userId: ctx.admin.id,
    });
    const nSpy = vi
      .spyOn(NodeService, 'bulkUpdateStatusByIds')
      .mockResolvedValue(2);
    // Per-id fallback for relations until Agent-B ships bulkUpdateStatusByIds
    const rSpy = vi
      .spyOn(RelationService, 'update')
      .mockResolvedValue({ relation_id: '10' } as never);

    const r = await request(app)
      .post(`/api/ai/jobs/${job.id}/approve`)
      .set('Authorization', `Bearer ${ctx.expertToken}`)
      .send({ node_ids: ['KP_1', 'KP_2'], relation_ids: ['10'] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, nodes: 2, relations: 1 });
    expect(nSpy).toHaveBeenCalledWith(
      'graph_test_x',
      ['KP_1', 'KP_2'],
      'approved',
    );
    expect(rSpy).toHaveBeenCalledWith('10', { status: 'approved' });
  });

  it('handles empty arrays without calling services', async () => {
    const ctx = await setupUsers();
    const tpl = await createTemplate(ctx.admin.id);
    const job = await createSucceededJob({
      templateId: tpl.id,
      userId: ctx.admin.id,
    });
    const nSpy = vi
      .spyOn(NodeService, 'bulkUpdateStatusByIds')
      .mockResolvedValue(0);
    const rSpy = vi.spyOn(RelationService, 'update');

    const r = await request(app)
      .post(`/api/ai/jobs/${job.id}/approve`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ node_ids: [], relation_ids: [] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, nodes: 0, relations: 0 });
    expect(nSpy).toHaveBeenCalledWith('graph_test_x', [], 'approved');
    expect(rSpy).not.toHaveBeenCalled();
  });

  it('operator is forbidden (403)', async () => {
    const ctx = await setupUsers();
    const tpl = await createTemplate(ctx.admin.id);
    const job = await createSucceededJob({
      templateId: tpl.id,
      userId: ctx.admin.id,
    });
    const r = await request(app)
      .post(`/api/ai/jobs/${job.id}/approve`)
      .set('Authorization', `Bearer ${ctx.operatorToken}`)
      .send({ node_ids: [], relation_ids: [] });
    expect(r.status).toBe(403);
  });
});

describe('POST /api/ai/jobs/:jobId/reject-all', () => {
  it('admin deletes candidates and returns counts', async () => {
    const ctx = await setupUsers();
    const tpl = await createTemplate(ctx.admin.id);
    const job = await createSucceededJob({
      templateId: tpl.id,
      userId: ctx.admin.id,
    });
    const nSpy = vi.spyOn(NodeService, 'bulkDeleteByJob').mockResolvedValue(2);
    const rSpy = vi
      .spyOn(RelationService, 'bulkDeleteByJob')
      .mockResolvedValue(1);

    const r = await request(app)
      .post(`/api/ai/jobs/${job.id}/reject-all`)
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, nodes: 2, relations: 1 });
    expect(nSpy).toHaveBeenCalledWith('graph_test_x', job.id);
    expect(rSpy).toHaveBeenCalledWith('graph_test_x', job.id);
  });

  it('expert can reject', async () => {
    const ctx = await setupUsers();
    const tpl = await createTemplate(ctx.admin.id);
    const job = await createSucceededJob({
      templateId: tpl.id,
      userId: ctx.admin.id,
    });
    vi.spyOn(NodeService, 'bulkDeleteByJob').mockResolvedValue(0);
    vi.spyOn(RelationService, 'bulkDeleteByJob').mockResolvedValue(0);

    const r = await request(app)
      .post(`/api/ai/jobs/${job.id}/reject-all`)
      .set('Authorization', `Bearer ${ctx.expertToken}`);
    expect(r.status).toBe(200);
  });

  it('operator is forbidden (403)', async () => {
    const ctx = await setupUsers();
    const tpl = await createTemplate(ctx.admin.id);
    const job = await createSucceededJob({
      templateId: tpl.id,
      userId: ctx.admin.id,
    });
    const r = await request(app)
      .post(`/api/ai/jobs/${job.id}/reject-all`)
      .set('Authorization', `Bearer ${ctx.operatorToken}`);
    expect(r.status).toBe(403);
  });
});
