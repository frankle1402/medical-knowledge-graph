import { Prisma } from '@prisma/client';
import { runQuery, closeDriver } from '../lib/neo4j.js';
import { prisma } from '../lib/prisma.js';

/**
 * Pack A Task 3 — one-shot, idempotent copy of Neo4j → Postgres for the
 * graph data model (graphs / nodes / relations).
 *
 * Run via `npm -w backend run migrate:from-neo4j`. Re-running is safe: each
 * record is upserted by primary key, and relations use the
 * (source_id, target_id, relation_type) unique constraint introduced in
 * `20260519104550_add_graph_tables`.
 *
 * Read order is graphs → nodes → relations to satisfy FKs. The
 * `BELONGS_TO_GRAPH` membership edges are discovered in Neo4j but skipped
 * when building the relation rows (they are encoded in PG via `node.graph_id`).
 */

export interface MigrationStats {
  graphs: number;
  nodes: number;
  relations: number;
}

export async function migrateFromNeo4j(): Promise<MigrationStats> {
  // 1. graphs
  const graphs = await runQuery<{ g: Record<string, unknown> }>(
    `MATCH (g:Graph) RETURN g { .* } AS g ORDER BY g.created_at ASC`,
  );
  for (const { g } of graphs) {
    await prisma.graph.upsert({
      where: { graph_id: g.graph_id as string },
      create: mapGraph(g),
      update: mapGraph(g),
    });
  }

  // 2. nodes — must come before relations (FK dependency)
  const nodes = await runQuery<{ n: Record<string, unknown> }>(
    `MATCH (n:Node)-[:BELONGS_TO_GRAPH]->(g:Graph)
     RETURN n { .*, graph_id: g.graph_id } AS n
     ORDER BY n.created_at ASC`,
  );
  for (const { n } of nodes) {
    await prisma.node.upsert({
      where: { node_id: n.node_id as string },
      create: mapNode(n),
      update: mapNode(n),
    });
  }

  // 3. relations (skip BELONGS_TO_GRAPH membership edges)
  const rels = await runQuery<{
    a: { node_id: string };
    b: { node_id: string };
    g: { graph_id: string };
    type: string;
    r: Record<string, unknown>;
  }>(
    `MATCH (a:Node)-[r]->(b:Node)
     MATCH (a)-[:BELONGS_TO_GRAPH]->(g:Graph)
     WHERE type(r) <> 'BELONGS_TO_GRAPH'
     RETURN a { .node_id } AS a, b { .node_id } AS b, g { .graph_id } AS g,
            type(r) AS type, r { .* } AS r`,
  );
  for (const row of rels) {
    await prisma.relation.upsert({
      where: {
        relations_unique_edge: {
          source_id: row.a.node_id,
          target_id: row.b.node_id,
          relation_type: row.type,
        },
      },
      create: {
        source_id: row.a.node_id,
        target_id: row.b.node_id,
        graph_id: row.g.graph_id,
        relation_type: row.type,
        status: (row.r.status as string) ?? 'approved',
        confidence: (row.r.confidence as number) ?? 1.0,
        description: (row.r.description as string) ?? null,
        ai_job_id: (row.r.ai_job_id as string) ?? null,
      },
      update: {
        status: (row.r.status as string) ?? 'approved',
        confidence: (row.r.confidence as number) ?? 1.0,
        description: (row.r.description as string) ?? null,
      },
    });
  }

  return { graphs: graphs.length, nodes: nodes.length, relations: rels.length };
}

function mapGraph(g: Record<string, unknown>) {
  return {
    graph_id: g.graph_id as string,
    graph_name: g.graph_name as string,
    graph_type: g.graph_type as string,
    subject: (g.subject as string) ?? null,
    course_name: (g.course_name as string) ?? null,
    description: (g.description as string) ?? null,
    status: (g.status as string) ?? 'active',
    created_by: (g.created_by as string) ?? null,
  };
}

function mapNode(n: Record<string, unknown>) {
  return {
    node_id: n.node_id as string,
    graph_id: n.graph_id as string,
    node_type: n.node_type as string,
    knowledge_type: (n.knowledge_type as string) ?? null,
    name: n.name as string,
    description: (n.description as string) ?? null,
    status: (n.status as string) ?? 'approved',
    source: (n.source as string) ?? 'manual',
    confidence: (n.confidence as number) ?? 1.0,
    tags: ((n.tags as unknown[]) ?? []) as Prisma.InputJsonValue,
    ai_job_id: (n.ai_job_id as string) ?? null,
  };
}

// CLI entrypoint — only runs when invoked directly via tsx/node, not when
// imported by tests.
if (
  process.argv[1]?.endsWith('migrate-from-neo4j.ts') ||
  process.argv[1]?.endsWith('migrate-from-neo4j.js')
) {
  migrateFromNeo4j()
    .then((stats) => {
      // eslint-disable-next-line no-console
      console.log('migrated:', stats);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await closeDriver();
      await prisma.$disconnect();
    });
}
