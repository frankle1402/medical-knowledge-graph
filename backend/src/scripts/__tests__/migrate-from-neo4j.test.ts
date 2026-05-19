import { describe, it, expect, beforeEach, afterAll } from 'vitest';
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
});
