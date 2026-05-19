import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { runQuery, closeDriver } from '../../lib/neo4j.js';
import { prisma } from '../../lib/prisma.js';
import { migrateFromNeo4j } from '../migrate-from-neo4j.js';

/**
 * Pack A Task 3 — one-shot Neo4j → Postgres migration.
 *
 * These tests exercise the script against the live Neo4j (test database) and
 * the live Postgres (configured via DATABASE_URL). They follow the spec in
 * docs/plans/2026-05-19-pg-migration/pack-a-schema.md verbatim.
 */

async function clearAll() {
  await runQuery('MATCH (n) DETACH DELETE n');
  // Order matters: relations FK -> nodes FK -> graphs.
  await prisma.relation.deleteMany();
  await prisma.node.deleteMany();
  await prisma.graph.deleteMany();
}

describe('migrate-from-neo4j', () => {
  beforeEach(clearAll);
  afterAll(async () => {
    await closeDriver();
    await prisma.$disconnect();
  });

  it('搬运 1 个空图谱', async () => {
    await runQuery(
      `CREATE (g:Graph {graph_id: 'G1', graph_name: '测试图', graph_type: 'medical', status: 'active', created_at: '2026-05-19T00:00:00Z'})`,
    );
    const stats = await migrateFromNeo4j();
    expect(stats.graphs).toBe(1);
    expect(stats.nodes).toBe(0);
    expect(stats.relations).toBe(0);
    const g = await prisma.graph.findUnique({ where: { graph_id: 'G1' } });
    expect(g?.graph_name).toBe('测试图');
  });

  it('搬运含节点和关系的图谱，关系正确指向 PG 节点', async () => {
    await runQuery(`
      CREATE (g:Graph {graph_id: 'G2', graph_name: 'G2', graph_type: 'medical', status: 'active', created_at: '2026-05-19T00:00:00Z'})
      CREATE (n1:Node {node_id: 'N1', graph_id: 'G2', node_type: 'knowledge_point', name: 'A', status: 'approved', source: 'manual', confidence: 1.0})
      CREATE (n2:Node {node_id: 'N2', graph_id: 'G2', node_type: 'knowledge_point', name: 'B', status: 'approved', source: 'manual', confidence: 1.0})
      CREATE (n1)-[:BELONGS_TO_GRAPH]->(g)
      CREATE (n2)-[:BELONGS_TO_GRAPH]->(g)
      CREATE (n1)-[:PREREQUISITE {relation_type: 'PREREQUISITE', status: 'approved', confidence: 1.0}]->(n2)
    `);
    const stats = await migrateFromNeo4j();
    expect(stats).toMatchObject({ graphs: 1, nodes: 2, relations: 1 });
    const rels = await prisma.relation.findMany({ where: { graph_id: 'G2' } });
    expect(rels[0]).toMatchObject({
      source_id: 'N1',
      target_id: 'N2',
      relation_type: 'PREREQUISITE',
    });
  });

  it('幂等 — 二次执行不会重复插入', async () => {
    await runQuery(
      `CREATE (g:Graph {graph_id: 'G3', graph_name: 'G3', graph_type: 'medical', status: 'active', created_at: '2026-05-19T00:00:00Z'})`,
    );
    await migrateFromNeo4j();
    await migrateFromNeo4j();
    const count = await prisma.graph.count();
    expect(count).toBe(1);
  });

  it('幂等 — 第二次执行反映关系最新 confidence', async () => {
    await runQuery(`
      CREATE (g:Graph {graph_id: 'GIDEM', graph_name: 'GIDEM', graph_type: 'medical', status: 'active', created_at: '2026-05-19T00:00:00Z'})
      CREATE (n1:Node {node_id: 'NI1', graph_id: 'GIDEM', node_type: 'knowledge_point', name: 'A', status: 'approved', source: 'manual', confidence: 1.0})
      CREATE (n2:Node {node_id: 'NI2', graph_id: 'GIDEM', node_type: 'knowledge_point', name: 'B', status: 'approved', source: 'manual', confidence: 1.0})
      CREATE (n1)-[:BELONGS_TO_GRAPH]->(g)
      CREATE (n2)-[:BELONGS_TO_GRAPH]->(g)
      CREATE (n1)-[:RELATED {relation_type: 'RELATED', status: 'approved', confidence: 0.5}]->(n2)
    `);
    await migrateFromNeo4j();
    const before = await prisma.relation.findFirst({
      where: { source_id: 'NI1', target_id: 'NI2', relation_type: 'RELATED' },
    });
    expect(before?.confidence).toBeCloseTo(0.5);

    // Bump confidence in Neo4j and re-run
    await runQuery(
      `MATCH (n1:Node {node_id: 'NI1'})-[r:RELATED]->(n2:Node {node_id: 'NI2'}) SET r.confidence = 0.9`,
    );
    const stats2 = await migrateFromNeo4j();
    expect(stats2).toMatchObject({ graphs: 1, nodes: 2, relations: 1 });
    const after = await prisma.relation.findFirst({
      where: { source_id: 'NI1', target_id: 'NI2', relation_type: 'RELATED' },
    });
    expect(after?.confidence).toBeCloseTo(0.9);
    const totalRels = await prisma.relation.count({ where: { graph_id: 'GIDEM' } });
    expect(totalRels).toBe(1);
  });

  it('多重边折叠 — 同 (source,target,type) 的 2 条边告警且 PG 仅 1 行', async () => {
    await runQuery(`
      CREATE (g:Graph {graph_id: 'GMULTI', graph_name: 'GMULTI', graph_type: 'medical', status: 'active', created_at: '2026-05-19T00:00:00Z'})
      CREATE (n1:Node {node_id: 'NM1', graph_id: 'GMULTI', node_type: 'knowledge_point', name: 'A', status: 'approved', source: 'manual', confidence: 1.0})
      CREATE (n2:Node {node_id: 'NM2', graph_id: 'GMULTI', node_type: 'knowledge_point', name: 'B', status: 'approved', source: 'manual', confidence: 1.0})
      CREATE (n1)-[:BELONGS_TO_GRAPH]->(g)
      CREATE (n2)-[:BELONGS_TO_GRAPH]->(g)
      CREATE (n1)-[:PREREQUISITE {relation_type: 'PREREQUISITE', status: 'approved', confidence: 0.5}]->(n2)
      CREATE (n1)-[:PREREQUISITE {relation_type: 'PREREQUISITE', status: 'approved', confidence: 0.9}]->(n2)
    `);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let warnCalls: unknown[][] = [];
    try {
      await migrateFromNeo4j();
    } finally {
      warnCalls = warn.mock.calls.map((c) => [...c]);
      warn.mockRestore();
    }

    const rels = await prisma.relation.findMany({ where: { graph_id: 'GMULTI' } });
    expect(rels).toHaveLength(1);

    const messages = warnCalls.map((c) => c.map(String).join(' '));
    const hit = messages.find(
      (m) =>
        m.includes('NM1') &&
        m.includes('NM2') &&
        m.includes('PREREQUISITE') &&
        /multi[-_ ]?edge/i.test(m),
    );
    expect(hit, `expected multi-edge warning, got ${JSON.stringify(messages)}`).toBeTruthy();
  });

  it('跨图关系 — 跳过并告警，节点仍迁移', async () => {
    await runQuery(`
      CREATE (g1:Graph {graph_id: 'GX1', graph_name: 'GX1', graph_type: 'medical', status: 'active', created_at: '2026-05-19T00:00:00Z'})
      CREATE (g2:Graph {graph_id: 'GX2', graph_name: 'GX2', graph_type: 'medical', status: 'active', created_at: '2026-05-19T00:00:00Z'})
      CREATE (a:Node {node_id: 'NX1', graph_id: 'GX1', node_type: 'knowledge_point', name: 'A', status: 'approved', source: 'manual', confidence: 1.0})
      CREATE (b:Node {node_id: 'NX2', graph_id: 'GX2', node_type: 'knowledge_point', name: 'B', status: 'approved', source: 'manual', confidence: 1.0})
      CREATE (a)-[:BELONGS_TO_GRAPH]->(g1)
      CREATE (b)-[:BELONGS_TO_GRAPH]->(g2)
      CREATE (a)-[:RELATED {relation_type: 'RELATED', status: 'approved', confidence: 1.0}]->(b)
    `);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let warnCalls: unknown[][] = [];
    try {
      const stats = await migrateFromNeo4j();
      expect(stats.nodes).toBe(2);
      expect(stats.relations).toBe(0);
    } finally {
      warnCalls = warn.mock.calls.map((c) => [...c]);
      warn.mockRestore();
    }

    const rels = await prisma.relation.findMany();
    expect(rels).toHaveLength(0);
    const nodeCount = await prisma.node.count();
    expect(nodeCount).toBe(2);

    const messages = warnCalls.map((c) => c.map(String).join(' '));
    const hit = messages.find(
      (m) =>
        m.includes('NX1') &&
        m.includes('NX2') &&
        m.includes('GX1') &&
        m.includes('GX2') &&
        /cross[-_ ]?graph/i.test(m),
    );
    expect(hit, `expected cross-graph warning, got ${JSON.stringify(messages)}`).toBeTruthy();
  });

  it('字段校验 — 节点 name 为 null 抛出指明字段+node_id 的错误', async () => {
    await runQuery(`
      CREATE (g:Graph {graph_id: 'GBAD', graph_name: 'GBAD', graph_type: 'medical', status: 'active', created_at: '2026-05-19T00:00:00Z'})
      CREATE (n:Node {node_id: 'NBAD1', graph_id: 'GBAD', node_type: 'knowledge_point', status: 'approved', source: 'manual', confidence: 1.0})
      CREATE (n)-[:BELONGS_TO_GRAPH]->(g)
    `);

    let caught: Error | null = null;
    try {
      await migrateFromNeo4j();
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toMatch(/^migration:/);
    expect(caught?.message).toMatch(/name/);
    expect(caught?.message).toMatch(/NBAD1/);
  });
});
