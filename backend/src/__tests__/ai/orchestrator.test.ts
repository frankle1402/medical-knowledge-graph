import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PromptTemplate, TemplateVariable } from '@mkg/shared';

import {
  AIJobOrchestrator,
  type NodeServicePort,
  type PrismaPort,
  type RelationServicePort,
} from '../../modules/ai/ai.orchestrator.js';
import { LLMAuthError } from '../../lib/llm/index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const VARIABLE_DEFS: TemplateVariable[] = [
  { key: 'course_name', label: '课程', type: 'text', required: true },
  { key: 'chapter_name', label: '章节', type: 'text', required: true },
  {
    key: 'depth',
    label: '详细程度',
    type: 'select',
    options: ['基础', '标准', '详细'],
    required: true,
  },
];

const TEMPLATE: Pick<
  PromptTemplate,
  'id' | 'system_prompt' | 'user_prompt_template' | 'variables'
> = {
  id: '00000000-0000-0000-0000-000000000001',
  system_prompt: '你是医学教育知识图谱专家。',
  user_prompt_template:
    '请为《{{course_name}}》中的「{{chapter_name}}」构建图谱。详细程度：{{depth}}',
  variables: VARIABLE_DEFS,
};

const SAMPLE_OUTPUT = {
  graph_name: '静脉输液',
  nodes: [
    {
      node_id: 'KP_001',
      node_type: 'knowledge_point',
      name: '静脉输液概念',
      knowledge_type: '概念类',
      confidence: 0.9,
    },
    {
      node_id: 'KP_002',
      node_type: 'knowledge_point',
      name: '静脉输液目的',
      knowledge_type: '目的类',
    },
    {
      node_id: 'KP_003',
      node_type: 'knowledge_point',
      name: '静脉输液操作',
      knowledge_type: '操作流程类',
    },
    {
      node_id: 'TM_001',
      node_type: 'term',
      name: '静脉输液',
      standard_term: '静脉输液',
      aliases: ['IV'],
    },
  ],
  relations: [
    { source_id: 'KP_001', target_id: 'KP_002', relation_type: 'PREREQUISITE_OF' },
    { source_id: 'KP_002', target_id: 'KP_003', relation_type: 'PREREQUISITE_OF' },
    { source_id: 'KP_001', target_id: 'TM_001', relation_type: 'STANDARD_TERM_OF' },
  ],
};

function makeFakePrisma(): PrismaPort & {
  __created: Array<Record<string, unknown>>;
  __updates: Array<{ id: string; data: Record<string, unknown> }>;
} {
  const created: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  let counter = 0;
  return {
    aiGenerationLog: {
      // Cast: PrismaClient generated types are too elaborate to satisfy here,
      // and we only call .create / .update.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: ((args: { data: Record<string, unknown> }) => {
        counter += 1;
        const id = `log-${counter}`;
        const row = { id, ...args.data };
        created.push(row);
        return Promise.resolve(row);
      }) as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: ((args: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: args.where.id, data: args.data });
        return Promise.resolve({ id: args.where.id, ...args.data });
      }) as never,
    } as unknown as PrismaPort['aiGenerationLog'],
    __created: created,
    __updates: updates,
  };
}

function makeNodeServiceStub(): NodeServicePort & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    bulkCreate: vi.fn(async (graphId, nodes, defaults) => {
      calls.push({ graphId, nodes, defaults });
      // echo back nodes with stable shape so caller can count length
      return nodes.map((n, idx) => ({
        ...n,
        node_id: (n as { node_id?: string }).node_id ?? `KP_${idx}`,
      })) as never;
    }),
  };
}

function makeRelationServiceStub(): RelationServicePort & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    bulkCreate: vi.fn(async (graphId, relations, defaults) => {
      calls.push({ graphId, relations, defaults });
      return relations.map((r, idx) => ({
        ...r,
        relation_id: `rel_${idx}`,
      })) as never;
    }),
  };
}

describe('AIJobOrchestrator.generate (DI version)', () => {
  it('runs the full pipeline: prompt → LLM → parse → map → persist', async () => {
    const prisma = makeFakePrisma();
    const nodeService = makeNodeServiceStub();
    const relationService = makeRelationServiceStub();

    const llm = vi.fn().mockResolvedValue({
      raw: JSON.stringify(SAMPLE_OUTPUT),
      output: SAMPLE_OUTPUT,
    });

    const orchestrator = new AIJobOrchestrator({
      prisma,
      nodeService,
      relationService,
      llm: llm as never,
    });

    const result = await orchestrator.generate({
      template: TEMPLATE,
      variables: {
        course_name: '基础护理学',
        chapter_name: '静脉输液',
        depth: '标准',
      },
      graphId: 'graph_x',
      userId: '00000000-0000-0000-0000-000000000abc',
    });

    expect(result.status).toBe('success');
    expect(result.nodesCreated).toBe(4);
    expect(result.relationsCreated).toBe(3);
    expect(result.graphName).toBe('静脉输液');

    // Verify LLM received the rendered system+user prompt
    expect(llm).toHaveBeenCalledTimes(1);
    const callArgs = (llm.mock.calls[0]![0]) as { chat: { system: string; user: string; responseFormat?: string } };
    expect(callArgs.chat.system).toBe(TEMPLATE.system_prompt);
    expect(callArgs.chat.user).toBe(
      '请为《基础护理学》中的「静脉输液」构建图谱。详细程度：标准',
    );
    expect(callArgs.chat.responseFormat).toBe('json_object');

    // Verify NodeService.bulkCreate received the graphId + candidate defaults
    expect(nodeService.bulkCreate).toHaveBeenCalledTimes(1);
    const [graphId, nodes, defaults] = (nodeService.bulkCreate as never as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(graphId).toBe('graph_x');
    expect(nodes).toHaveLength(4);
    expect(defaults).toEqual({
      status: 'candidate',
      source: 'ai_generated',
      ai_job_id: 'log-1',
    });

    // Verify RelationService.bulkCreate
    expect(relationService.bulkCreate).toHaveBeenCalledTimes(1);

    // Persistence: log created with status=running, then updated to success
    expect(prisma.__created).toHaveLength(1);
    expect((prisma.__created[0] as { status: string }).status).toBe('running');
    expect(prisma.__updates).toHaveLength(1);
    expect(prisma.__updates[0]!.data.status).toBe('success');
    expect(prisma.__updates[0]!.data.nodes_created).toBe(4);
    expect(prisma.__updates[0]!.data.relations_created).toBe(3);
  });

  it('marks log as failed when LLM throws (auth error not retried)', async () => {
    const prisma = makeFakePrisma();
    const nodeService = makeNodeServiceStub();
    const relationService = makeRelationServiceStub();

    const llm = vi.fn().mockRejectedValue(new LLMAuthError('bad key', 401));
    const orchestrator = new AIJobOrchestrator({
      prisma,
      nodeService,
      relationService,
      llm: llm as never,
    });

    await expect(
      orchestrator.generate({
        template: TEMPLATE,
        variables: {
          course_name: 'a',
          chapter_name: 'b',
          depth: '标准',
        },
        graphId: 'graph_x',
        userId: '00000000-0000-0000-0000-000000000abc',
      }),
    ).rejects.toBeInstanceOf(LLMAuthError);

    expect(prisma.__updates).toHaveLength(1);
    expect(prisma.__updates[0]!.data.status).toBe('failed');
    expect(prisma.__updates[0]!.data.error_msg).toMatch(/bad key/);
    // Node/Relation services NOT called when LLM fails
    expect(nodeService.bulkCreate).not.toHaveBeenCalled();
    expect(relationService.bulkCreate).not.toHaveBeenCalled();
  });

  it('marks log as failed when variable validation fails (no LLM call)', async () => {
    const prisma = makeFakePrisma();
    const nodeService = makeNodeServiceStub();
    const relationService = makeRelationServiceStub();
    const llm = vi.fn();

    const orchestrator = new AIJobOrchestrator({
      prisma,
      nodeService,
      relationService,
      llm: llm as never,
    });

    await expect(
      orchestrator.generate({
        template: TEMPLATE,
        variables: { chapter_name: 'b' /* missing course_name */ },
        graphId: 'graph_x',
        userId: '00000000-0000-0000-0000-000000000abc',
      }),
    ).rejects.toThrow(/course_name/);

    expect(llm).not.toHaveBeenCalled();
    expect(prisma.__updates[0]!.data.status).toBe('failed');
  });
});
