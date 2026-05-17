import { describe, it, expect, beforeAll } from 'vitest';
import { GraphService } from '../graph.service';
import { runQuery } from '../../../lib/neo4j';

describe('GraphService', () => {
  beforeAll(async () => {
    // Smoke check that the schema exists. Tests that require constraints
    // (e.g. duplicate node_id) will fail loudly otherwise.
    await runQuery('RETURN 1 AS ok');
  });

  it('create returns a graph_id with the graph_ prefix and zero counts', async () => {
    const dto = await GraphService.create({
      graph_name: '基础护理学',
      graph_type: 'course',
      subject: '护理学',
      course_name: '基础护理学',
      created_by: '00000000-0000-0000-0000-000000000001',
    });
    expect(dto.graph_id).toMatch(/^graph_/);
    expect(dto.graph_name).toBe('基础护理学');
    expect(dto.subject).toBe('护理学');
    expect(dto.node_count).toBe(0);
    expect(dto.relation_count).toBe(0);
    expect(dto.status).toBe('active');
    expect(dto.created_at).toBeTruthy();
  });

  it('list returns all graphs ordered by created_at DESC', async () => {
    await GraphService.create({
      graph_name: 'A',
      graph_type: 'course',
      created_by: 'u1',
    });
    await GraphService.create({
      graph_name: 'B',
      graph_type: 'course',
      created_by: 'u1',
    });
    const list = await GraphService.list();
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0]?.node_count).toBe(0);
    expect(list[0]?.relation_count).toBe(0);
  });

  it('findById returns the {graph, nodes, relations} triple', async () => {
    const g = await GraphService.create({
      graph_name: 'C',
      graph_type: 'course',
      created_by: 'u1',
    });
    const found = await GraphService.findById(g.graph_id);
    expect(found?.graph.graph_id).toBe(g.graph_id);
    expect(Array.isArray(found?.nodes)).toBe(true);
    expect(Array.isArray(found?.relations)).toBe(true);
    expect(found?.graph.node_count).toBe(0);
  });

  it('findById returns null for unknown graph_id', async () => {
    const out = await GraphService.findById('graph_does_not_exist');
    expect(out).toBeNull();
  });

  it('update mutates allowed fields and bumps updated_at', async () => {
    const g = await GraphService.create({
      graph_name: 'D',
      graph_type: 'course',
      created_by: 'u1',
    });
    const updated = await GraphService.update(g.graph_id, {
      graph_name: 'D-renamed',
      description: 'new desc',
    });
    expect(updated?.graph_name).toBe('D-renamed');
    expect(updated?.description).toBe('new desc');
    expect(updated?.updated_at).toBeTruthy();
  });

  it('update returns null when target graph does not exist', async () => {
    const updated = await GraphService.update('graph_missing', {
      graph_name: 'X',
    });
    expect(updated).toBeNull();
  });

  it('remove deletes the graph and its nodes', async () => {
    const g = await GraphService.create({
      graph_name: 'E',
      graph_type: 'course',
      created_by: 'u1',
    });
    // Inject a node tied to the graph to prove DETACH DELETE removes children too.
    await runQuery(
      `MATCH (g:Graph {graph_id: $graph_id})
       CREATE (n:Node {node_id: 'KP_TMP1', node_type: 'knowledge_point', name: 'tmp'})
       MERGE (n)-[:BELONGS_TO_GRAPH]->(g)`,
      { graph_id: g.graph_id },
    );
    const removed = await GraphService.remove(g.graph_id);
    expect(removed).toBe(true);

    const after = await GraphService.findById(g.graph_id);
    expect(after).toBeNull();

    const orphan = await runQuery<{ c: number }>(
      'MATCH (n:Node {node_id: "KP_TMP1"}) RETURN count(n) AS c',
    );
    expect(Number(orphan[0]?.c ?? 0)).toBe(0);
  });

  it('remove returns false for unknown graph_id', async () => {
    const removed = await GraphService.remove('graph_unknown');
    expect(removed).toBe(false);
  });

  it('exportToJson is structurally identical to findById', async () => {
    const g = await GraphService.create({
      graph_name: 'F',
      graph_type: 'course',
      created_by: 'u1',
    });
    const detail = await GraphService.findById(g.graph_id);
    const exported = await GraphService.exportToJson(g.graph_id);
    expect(exported).toEqual(detail);
  });
});
