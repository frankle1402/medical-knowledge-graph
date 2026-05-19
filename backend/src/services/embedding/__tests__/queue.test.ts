/**
 * Queue + hook integration tests.
 *
 * What's mocked: the openai SDK is mocked so no network calls happen. The
 * Postgres write path is real — these tests exercise pgvector insertion via
 * `$executeRaw` against the test DB, which is what we ship.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GraphService } from '../../../modules/graphs/graph.service';
import { NodeService } from '../../../modules/nodes/node.service';
import { prisma } from '../../../lib/prisma';
import {
  enqueueEmbedding,
  registerEmbeddingHook,
  unregisterEmbeddingHook,
  whenIdle,
  getEmbeddingQueueStats,
  _resetQueue,
} from '../queue';
import { EMBEDDING_DIM, _resetClient } from '../openai';

const createMock = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: (...args: unknown[]) => createMock(...args),
    },
  })),
}));

function vecOf(fill: number): number[] {
  return new Array(EMBEDDING_DIM).fill(fill);
}

async function readEmbeddingDim(node_id: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ d: number | null }>>`
    SELECT vector_dims(embedding) AS d FROM nodes WHERE node_id = ${node_id}
  `;
  return rows[0]?.d ?? null;
}

describe('embedding queue', () => {
  let graphId: string;

  beforeEach(async () => {
    _resetQueue();
    _resetClient();
    createMock.mockReset();
    createMock.mockImplementation(async ({ input }: { input: string | string[] }) => {
      const arr = Array.isArray(input) ? input : [input];
      return { data: arr.map(() => ({ embedding: vecOf(0.05) })) };
    });
    const g = await GraphService.create({
      graph_name: 'queue-test',
      graph_type: 'course',
      created_by: 'tester',
    });
    graphId = g.graph_id;
  });

  afterEach(() => {
    unregisterEmbeddingHook();
    _resetQueue();
  });

  it('enqueueEmbedding writes the vector to Postgres', async () => {
    const n = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'queue-direct',
      knowledge_type: '概念类',
    } as never);
    enqueueEmbedding({
      node_id: n!.node_id as string,
      name: n!.name as string,
      description: null,
      tags: [],
    });
    await whenIdle();
    const dim = await readEmbeddingDim(n!.node_id as string);
    expect(dim).toBe(EMBEDDING_DIM);
    const stats = getEmbeddingQueueStats();
    expect(stats.succeeded).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it('hook fires on create() and writes the embedding', async () => {
    registerEmbeddingHook();
    const n = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: '心率失常',
      description: '心跳节律不齐',
      knowledge_type: '概念类',
    } as never);
    await whenIdle();
    const dim = await readEmbeddingDim(n!.node_id as string);
    expect(dim).toBe(EMBEDDING_DIM);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('skips re-embedding when an update did not change embedding text', async () => {
    registerEmbeddingHook();
    const n = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'stale',
      description: 'desc1',
      knowledge_type: '概念类',
    } as never);
    await whenIdle();
    expect(createMock).toHaveBeenCalledTimes(1);
    // Status flip — name / description / tags unchanged.
    await NodeService.update(n!.node_id as string, {
      status: 'approved',
    } as never);
    await whenIdle();
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(getEmbeddingQueueStats().skipped).toBe(1);
  });

  it('re-embeds when description actually changes', async () => {
    registerEmbeddingHook();
    const n = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'changes',
      description: 'before',
      knowledge_type: '概念类',
    } as never);
    await whenIdle();
    await NodeService.update(n!.node_id as string, {
      description: 'after',
    } as never);
    await whenIdle();
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(getEmbeddingQueueStats().skipped).toBe(0);
  });

  it('createBatch fires the hook for every row', async () => {
    registerEmbeddingHook();
    const inputs = [
      {
        node_id: 'KP_QUEUE_BATCH_1',
        node_type: 'knowledge_point' as const,
        name: 'b1',
        knowledge_type: '概念类',
      },
      {
        node_id: 'KP_QUEUE_BATCH_2',
        node_type: 'knowledge_point' as const,
        name: 'b2',
        knowledge_type: '概念类',
      },
    ];
    await NodeService.createBatch(graphId, inputs, { ai_job_id: 'qbatch' });
    await whenIdle();
    const dim1 = await readEmbeddingDim('KP_QUEUE_BATCH_1');
    const dim2 = await readEmbeddingDim('KP_QUEUE_BATCH_2');
    expect(dim1).toBe(EMBEDDING_DIM);
    expect(dim2).toBe(EMBEDDING_DIM);
  });

  it('worker survives an embed() failure and keeps draining', async () => {
    registerEmbeddingHook();
    let calls = 0;
    createMock.mockImplementation(async ({ input }: { input: string | string[] }) => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      const arr = Array.isArray(input) ? input : [input];
      return { data: arr.map(() => ({ embedding: vecOf(0.05) })) };
    });
    const n1 = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'fail-first',
      knowledge_type: '概念类',
    } as never);
    const n2 = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'succeed-second',
      knowledge_type: '概念类',
    } as never);
    await whenIdle();
    expect(getEmbeddingQueueStats().failed).toBe(1);
    expect(getEmbeddingQueueStats().succeeded).toBe(1);
    // First node has no embedding; second does.
    expect(await readEmbeddingDim(n1!.node_id as string)).toBeNull();
    expect(await readEmbeddingDim(n2!.node_id as string)).toBe(EMBEDDING_DIM);
  });
});
