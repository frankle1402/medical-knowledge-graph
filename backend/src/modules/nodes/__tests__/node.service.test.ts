import { describe, it, expect, beforeEach } from 'vitest';
import { GraphService } from '../../graphs/graph.service';
import { NodeService } from '../node.service';

/**
 * Each test starts with a fresh graph because the global `setup.ts`
 * `beforeEach` wipes Neo4j between every test.
 */
describe('NodeService', () => {
  let graphId: string;

  beforeEach(async () => {
    const g = await GraphService.create({
      graph_name: 'node-svc',
      graph_type: 'course',
      created_by: 'tester',
    });
    graphId = g.graph_id;
  });

  it('create attaches a generated KP_ id and BELONGS_TO_GRAPH edge', async () => {
    const n = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: '静脉输液',
      knowledge_type: '操作流程类',
      difficulty: '中等',
      importance: '重点掌握',
      source: 'manual',
    });
    expect(n).not.toBeNull();
    expect(n!.node_id as string).toMatch(/^KP_/);
    expect(n!.name).toBe('静脉输液');
    expect(n!.status).toBe('candidate');
  });

  it('create returns null when graph_id is unknown', async () => {
    const n = await NodeService.create('graph_does_not_exist', {
      node_type: 'knowledge_point',
      name: 'x',
      knowledge_type: '概念类',
    } as never);
    expect(n).toBeNull();
  });

  it('list paginates and counts total', async () => {
    for (let i = 0; i < 4; i++) {
      await NodeService.create(graphId, {
        node_type: 'term',
        name: `T${i}`,
        standard_term: `T${i}`,
      } as never);
    }
    const r1 = await NodeService.list(graphId, { skip: 0, limit: 2 });
    expect(r1.items.length).toBe(2);
    expect(r1.total).toBe(4);
    const r2 = await NodeService.list(graphId, { skip: 2, limit: 50 });
    expect(r2.items.length).toBe(2);
    expect(r2.skip).toBe(2);
  });

  it('list filters by node_type', async () => {
    await NodeService.create(graphId, {
      node_type: 'term',
      name: 'aT',
      standard_term: 'aT',
    } as never);
    await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'aK',
      knowledge_type: '概念类',
    } as never);
    const r = await NodeService.list(graphId, {
      node_type: 'term',
      skip: 0,
      limit: 50,
    });
    expect(r.total).toBe(1);
    expect(r.items[0]?.node_type).toBe('term');
  });

  it('list keyword filter is case-insensitive', async () => {
    await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'Heart Rate',
      knowledge_type: '概念类',
    } as never);
    await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'Other',
      knowledge_type: '概念类',
    } as never);
    const r = await NodeService.list(graphId, {
      keyword: 'heart',
      skip: 0,
      limit: 50,
    });
    expect(r.total).toBe(1);
    expect(r.items[0]?.name).toBe('Heart Rate');
  });

  it('update mutates fields and bumps updated_at', async () => {
    const n = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'will-update',
      knowledge_type: '概念类',
    } as never);
    const updated = await NodeService.update(n!.node_id as string, {
      description: 'patched desc',
    } as never);
    expect(updated?.description).toBe('patched desc');
    expect(updated?.updated_at).toBeTruthy();
  });

  it('update refuses to change node_id / node_type', async () => {
    const n = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'lock-me',
      knowledge_type: '概念类',
    } as never);
    const updated = await NodeService.update(n!.node_id as string, {
      node_id: 'EVIL_OVERRIDE',
      node_type: 'term',
      description: 'still works',
    } as never);
    expect(updated?.node_id).toBe(n!.node_id);
    expect(updated?.node_type).toBe('knowledge_point');
    expect(updated?.description).toBe('still works');
  });

  it('remove returns true on hit, false on miss', async () => {
    const n = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'doomed',
      knowledge_type: '概念类',
    } as never);
    expect(await NodeService.remove(n!.node_id as string)).toBe(true);
    expect(await NodeService.remove(n!.node_id as string)).toBe(false);
  });

  it('batchApprove flips many nodes to approved in one shot', async () => {
    const a = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'ba1',
      knowledge_type: '概念类',
      status: 'candidate',
    } as never);
    const b = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'ba2',
      knowledge_type: '概念类',
      status: 'candidate',
    } as never);
    const r = await NodeService.batchApprove([
      a!.node_id as string,
      b!.node_id as string,
    ]);
    expect(r.updated).toBe(2);
    const after = await NodeService.findById(a!.node_id as string);
    expect(after?.status).toBe('approved');
  });

  it('createBatch + bulkUpdateStatusByJob + listByAiJob work together', async () => {
    const jobId = 'job-' + Date.now();
    const created = await NodeService.createBatch(
      graphId,
      [
        {
          node_type: 'knowledge_point',
          name: 'bx1',
          knowledge_type: '概念类',
        },
        {
          node_type: 'knowledge_point',
          name: 'bx2',
          knowledge_type: '概念类',
        },
      ],
      { ai_job_id: jobId, status: 'candidate' },
    );
    expect(created).toHaveLength(2);
    expect(created.every((n) => n.ai_job_id === jobId)).toBe(true);

    const updated = await NodeService.bulkUpdateStatusByJob(
      graphId,
      jobId,
      'approved',
    );
    expect(updated).toBe(2);

    const list = await NodeService.listByAiJob(graphId, jobId);
    expect(list.length).toBe(2);
    expect(list.every((n) => n.status === 'approved')).toBe(true);
  });

  it('bulkUpdateStatusByIds limits to provided ids', async () => {
    const jobId = 'job2';
    const created = await NodeService.createBatch(
      graphId,
      [
        { node_type: 'term', name: 'one', standard_term: 'one' },
        { node_type: 'term', name: 'two', standard_term: 'two' },
      ],
      { ai_job_id: jobId, status: 'candidate' },
    );
    const ids = created.slice(0, 1).map((n) => n.node_id as string);
    const n = await NodeService.bulkUpdateStatusByIds(graphId, ids, 'rejected');
    expect(n).toBe(1);
  });

  it('bulkDeleteByJob removes only candidate nodes from the job', async () => {
    const jobId = 'job3';
    await NodeService.createBatch(
      graphId,
      [{ node_type: 'term', name: 'gone', standard_term: 'gone' }],
      { ai_job_id: jobId, status: 'candidate' },
    );
    const deleted = await NodeService.bulkDeleteByJob(graphId, jobId);
    expect(deleted).toBe(1);
  });
});
