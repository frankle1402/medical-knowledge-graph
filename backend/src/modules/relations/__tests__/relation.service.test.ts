import { describe, it, expect, beforeEach } from 'vitest';
import { GraphService } from '../../graphs/graph.service';
import { NodeService } from '../../nodes/node.service';
import { RelationService } from '../relation.service';
import { prisma } from '../../../lib/prisma';

describe('RelationService', () => {
  let graphId: string;
  let aId: string;
  let bId: string;

  beforeEach(async () => {
    const g = await GraphService.create({
      graph_name: 'rel-svc',
      graph_type: 'course',
      created_by: 'tester',
    });
    graphId = g.graph_id;
    const a = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'A',
      knowledge_type: '概念类',
    } as never);
    const b = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'B',
      knowledge_type: '概念类',
    } as never);
    aId = a!.node_id as string;
    bId = b!.node_id as string;
  });

  it('create writes a typed relationship and returns DTO', async () => {
    const r = await RelationService.create(graphId, {
      source_id: aId,
      target_id: bId,
      relation_type: 'PREREQUISITE_OF',
    });
    expect(r.relation_id).toMatch(/^\d+$/);
    expect(r.relation_type).toBe('PREREQUISITE_OF');
    expect(r.source_id).toBe(aId);
    expect(r.target_id).toBe(bId);
  });

  it('create rejects relation_type BELONGS_TO_GRAPH', async () => {
    await expect(
      RelationService.create(graphId, {
        source_id: aId,
        target_id: bId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        relation_type: 'BELONGS_TO_GRAPH' as any,
      }),
    ).rejects.toThrow();
  });

  it('create fails when nodes do not belong to the graph', async () => {
    const otherGraph = await GraphService.create({
      graph_name: 'other',
      graph_type: 'course',
      created_by: 't',
    });
    const c = await NodeService.create(otherGraph.graph_id, {
      node_type: 'knowledge_point',
      name: 'C',
      knowledge_type: '概念类',
    } as never);
    await expect(
      RelationService.create(graphId, {
        source_id: aId,
        target_id: c!.node_id as string,
        relation_type: 'RELATED_TO',
      }),
    ).rejects.toThrow();
  });

  it('listByGraph excludes BELONGS_TO_GRAPH membership edges', async () => {
    await RelationService.create(graphId, {
      source_id: aId,
      target_id: bId,
      relation_type: 'RELATED_TO',
    });
    const list = await RelationService.listByGraph(graphId);
    expect(list.length).toBe(1);
    expect(list[0]?.relation_type).toBe('RELATED_TO');
    expect(list.every((r) => r.relation_type !== 'BELONGS_TO_GRAPH')).toBe(true);
  });

  it('update mutates description / confidence', async () => {
    const r = await RelationService.create(graphId, {
      source_id: aId,
      target_id: bId,
      relation_type: 'RELATED_TO',
    });
    const updated = await RelationService.update(r.relation_id, {
      description: 'because',
      confidence: 0.42,
    });
    expect(updated?.description).toBe('because');
    expect(updated?.confidence).toBe(0.42);
  });

  it('update mutates relation_type', async () => {
    const r = await RelationService.create(graphId, {
      source_id: aId,
      target_id: bId,
      relation_type: 'RELATED_TO',
    });
    const updated = await RelationService.update(r.relation_id, {
      relation_type: 'PREREQUISITE_OF',
    });
    expect(updated?.relation_type).toBe('PREREQUISITE_OF');
  });

  it('update rejects relation_type BELONGS_TO_GRAPH', async () => {
    const r = await RelationService.create(graphId, {
      source_id: aId,
      target_id: bId,
      relation_type: 'RELATED_TO',
    });
    await expect(
      RelationService.update(r.relation_id, {
        relation_type: 'BELONGS_TO_GRAPH' as any,
      }),
    ).rejects.toThrow(/BELONGS_TO_GRAPH/);
  });

  it('update accepts status + confidence + relation_type together', async () => {
    const r = await RelationService.create(graphId, {
      source_id: aId,
      target_id: bId,
      relation_type: 'RELATED_TO',
    });
    const updated = await RelationService.update(r.relation_id, {
      relation_type: 'EASILY_CONFUSED_WITH',
      confidence: 0.7,
      status: 'approved',
      description: 'reviewed',
    });
    expect(updated?.relation_type).toBe('EASILY_CONFUSED_WITH');
    expect(updated?.confidence).toBe(0.7);
    expect(updated?.status).toBe('approved');
    expect(updated?.description).toBe('reviewed');
  });

  it('update returns null for missing relation', async () => {
    const updated = await RelationService.update('999999999', {
      description: 'ghost',
    });
    expect(updated).toBeNull();
  });

  it('remove deletes the relationship and returns true', async () => {
    const r = await RelationService.create(graphId, {
      source_id: aId,
      target_id: bId,
      relation_type: 'RELATED_TO',
    });
    expect(await RelationService.remove(r.relation_id)).toBe(true);
    expect(await RelationService.remove(r.relation_id)).toBe(false);
  });

  it('createBatch groups by relation_type and writes via UNWIND', async () => {
    const written = await RelationService.createBatch(
      graphId,
      [
        {
          source_id: aId,
          target_id: bId,
          relation_type: 'PREREQUISITE_OF',
        },
        {
          source_id: aId,
          target_id: bId,
          relation_type: 'RELATED_TO',
        },
      ],
      { ai_job_id: 'rj1', status: 'candidate' },
    );
    expect(written).toBe(2);
    const list = await RelationService.listByGraph(graphId);
    const types = list.map((r) => r.relation_type).sort();
    expect(types).toEqual(['PREREQUISITE_OF', 'RELATED_TO']);
  });

  it('bulkUpdateStatusByJob flips status for relations of one job', async () => {
    await RelationService.createBatch(
      graphId,
      [
        {
          source_id: aId,
          target_id: bId,
          relation_type: 'RELATED_TO',
        },
      ],
      { ai_job_id: 'rj2', status: 'candidate' },
    );
    const updated = await RelationService.bulkUpdateStatusByJob(
      graphId,
      'rj2',
      'approved',
    );
    expect(updated).toBe(1);
  });

  it('bulkDeleteByJob removes only candidate relations from the job', async () => {
    await RelationService.createBatch(
      graphId,
      [
        {
          source_id: aId,
          target_id: bId,
          relation_type: 'RELATED_TO',
        },
      ],
      { ai_job_id: 'rj3', status: 'candidate' },
    );
    const deleted = await RelationService.bulkDeleteByJob(graphId, 'rj3');
    expect(deleted).toBe(1);
  });

  it('persists tags object on create + read', async () => {
    const r = await RelationService.create(graphId, {
      source_id: aId,
      target_id: bId,
      relation_type: 'PREREQUISITE_OF',
      tags: {
        reason: '前置概念',
        evidence_quote: '需先掌握 A 才能学习 B',
      },
    });
    expect((r.tags as Record<string, unknown>).reason).toBe('前置概念');

    const fresh = await prisma.relation.findUnique({
      where: { relation_id: BigInt(r.relation_id) },
    });
    expect((fresh?.tags as Record<string, unknown>).reason).toBe('前置概念');
    expect((fresh?.tags as Record<string, unknown>).evidence_quote).toBe(
      '需先掌握 A 才能学习 B',
    );

    // listByGraph should also surface the tags
    const list = await RelationService.listByGraph(graphId);
    const found = list.find((x) => x.relation_id === r.relation_id);
    expect((found?.tags as Record<string, unknown>).reason).toBe('前置概念');
  });

  it('defaults tags to {} when not provided on create', async () => {
    const r = await RelationService.create(graphId, {
      source_id: aId,
      target_id: bId,
      relation_type: 'RELATED_TO',
    });
    expect(r.tags).toEqual({});
  });

  it('update accepts tags patch and persists merged JSON', async () => {
    const r = await RelationService.create(graphId, {
      source_id: aId,
      target_id: bId,
      relation_type: 'RELATED_TO',
      tags: { reason: 'initial' },
    });
    const updated = await RelationService.update(r.relation_id, {
      tags: { reason: 'revised', direction_explanation: 'A 引出 B' },
    });
    expect((updated?.tags as Record<string, unknown>).reason).toBe('revised');
    expect((updated?.tags as Record<string, unknown>).direction_explanation).toBe(
      'A 引出 B',
    );
  });

  it('createBatch persists tags per relation', async () => {
    const written = await RelationService.createBatch(
      graphId,
      [
        {
          source_id: aId,
          target_id: bId,
          relation_type: 'PREREQUISITE_OF',
          // batch input is loosely typed in the service; cast keeps the test honest
          tags: { reason: '前置' },
        } as never,
      ],
      { ai_job_id: 'rj-tags', status: 'candidate' },
    );
    expect(written).toBe(1);
    const list = await RelationService.listByGraph(graphId);
    const found = list.find((x) => x.relation_type === 'PREREQUISITE_OF');
    expect((found?.tags as Record<string, unknown>).reason).toBe('前置');
  });
});
