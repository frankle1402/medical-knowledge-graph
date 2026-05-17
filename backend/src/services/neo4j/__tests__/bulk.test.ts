import { describe, it, expect, beforeEach } from 'vitest';
import { GraphService } from '../../../modules/graphs/graph.service';
import { NodeService } from '../../../modules/nodes/node.service';
import { RelationService } from '../../../modules/relations/relation.service';
import { bulkUpsert } from '../bulk';

describe('bulkUpsert (Agent-C entry point)', () => {
  let graphId: string;

  beforeEach(async () => {
    const g = await GraphService.create({
      graph_name: 'bulk',
      graph_type: 'course',
      created_by: 't',
    });
    graphId = g.graph_id;
  });

  it('writes nodes + relations in one call and tags both with ai_job_id', async () => {
    const jobId = 'bulk-job-1';
    const result = await bulkUpsert({
      graph_id: graphId,
      ai_job_id: jobId,
      nodes: [
        { node_id: 'KP_BULK1', node_type: 'knowledge_point', name: 'A', knowledge_type: '概念类' },
        { node_id: 'KP_BULK2', node_type: 'knowledge_point', name: 'B', knowledge_type: '概念类' },
      ],
      relations: [
        {
          source_id: 'KP_BULK1',
          target_id: 'KP_BULK2',
          relation_type: 'PREREQUISITE_OF',
        },
      ],
    });
    expect(result.nodes_written).toBe(2);
    expect(result.relations_written).toBe(1);

    const list = await NodeService.listByAiJob(graphId, jobId);
    expect(list.length).toBe(2);
    expect(list.every((n) => n.status === 'candidate')).toBe(true);

    const rels = await RelationService.listByGraph(graphId);
    expect(rels.length).toBe(1);
    expect(rels[0]?.relation_type).toBe('PREREQUISITE_OF');
  });

  it('is idempotent — second call with the same node ids does not duplicate', async () => {
    const payload = {
      graph_id: graphId,
      ai_job_id: 'bulk-job-2',
      nodes: [
        { node_id: 'KP_IDEM1', node_type: 'knowledge_point', name: 'X', knowledge_type: '概念类' },
      ],
      relations: [],
    };
    await bulkUpsert(payload);
    await bulkUpsert(payload);
    const list = await NodeService.listByAiJob(graphId, 'bulk-job-2');
    expect(list.length).toBe(1);
  });

  it('rejects an unknown relation_type via Zod', async () => {
    await expect(
      bulkUpsert({
        graph_id: graphId,
        ai_job_id: 'bulk-bad',
        nodes: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        relations: [{ source_id: 'a', target_id: 'b', relation_type: 'NOT_A_TYPE' as any }],
      }),
    ).rejects.toThrow();
  });
});
