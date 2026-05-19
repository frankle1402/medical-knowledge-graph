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
 *
 * Pack A review fixes (W1–W6):
 *   W1 multi-edge collapse warning: aggregate per (source,target,type) in
 *      Cypher; if count>1, log a warning so operators can audit before the
 *      unique constraint silently picks one row.
 *   W2 transaction batching: each phase upserts 500 rows per
 *      `prisma.$transaction([...])` chunk. Crash recovery and connection
 *      load are both bounded.
 *   W4 cross-graph guard: relations whose source.graph_id ≠ target.graph_id
 *      are skipped + warned. Migrating them would corrupt graph_id integrity.
 *   W5 strict validation: `requireString` throws a labelled error rather
 *      than letting Prisma fail 50 lines deeper. `tags` is checked to be a
 *      real array; non-arrays are warned and defaulted to [].
 */

export interface MigrationStats {
  graphs: number;
  nodes: number;
  relations: number;
}

const BATCH_SIZE = 500;

export async function migrateFromNeo4j(): Promise<MigrationStats> {
  // 1. graphs
  const graphs = await runQuery<{ g: Record<string, unknown> }>(
    `MATCH (g:Graph) RETURN g { .* } AS g ORDER BY g.created_at ASC`,
  );
  for (const batch of chunk(graphs, BATCH_SIZE)) {
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const { g } of batch) {
      const data = mapGraph(g);
      ops.push(
        prisma.graph.upsert({
          where: { graph_id: data.graph_id },
          create: data,
          update: data,
        }),
      );
    }
    await prisma.$transaction(ops);
  }

  // 2. nodes — must come before relations (FK dependency)
  const nodes = await runQuery<{ n: Record<string, unknown> }>(
    `MATCH (n:Node)-[:BELONGS_TO_GRAPH]->(g:Graph)
     RETURN n { .*, graph_id: g.graph_id } AS n
     ORDER BY n.created_at ASC`,
  );
  for (const batch of chunk(nodes, BATCH_SIZE)) {
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const { n } of batch) {
      const data = mapNode(n);
      ops.push(
        prisma.node.upsert({
          where: { node_id: data.node_id },
          create: data,
          update: data,
        }),
      );
    }
    await prisma.$transaction(ops);
  }

  // 3. relations (skip BELONGS_TO_GRAPH membership edges).
  //
  // Notes on the Cypher:
  //   - We MATCH the membership edges for both endpoints so we can detect
  //     cross-graph relations (W4). source.g.graph_id and target.g2.graph_id
  //     are returned separately; the JS layer decides skip vs accept so the
  //     warning carries both ids.
  //   - We pre-aggregate count(r) per (a,b,type) triple so the JS layer can
  //     warn on multi-edge collapses (W1) without re-querying.
  //   - r { .* } returns the FIRST relationship's properties when count>1.
  //     That matches the existing upsert semantics — we just surface the
  //     fact that data was lost.
  const rels = await runQuery<{
    a: { node_id: string };
    b: { node_id: string };
    g: { graph_id: string };
    g2: { graph_id: string };
    type: string;
    r: Record<string, unknown>;
    edge_count: number;
  }>(
    `MATCH (a:Node)-[r]->(b:Node)
     MATCH (a)-[:BELONGS_TO_GRAPH]->(g:Graph)
     MATCH (b)-[:BELONGS_TO_GRAPH]->(g2:Graph)
     WHERE type(r) <> 'BELONGS_TO_GRAPH'
     WITH a, b, g, g2, type(r) AS type, collect(r) AS rs
     RETURN a { .node_id } AS a, b { .node_id } AS b,
            g { .graph_id } AS g, g2 { .graph_id } AS g2,
            type, properties(head(rs)) AS r, size(rs) AS edge_count`,
  );

  const acceptedRels: typeof rels = [];
  for (const row of rels) {
    const sourceGraph = requireString(row.g?.graph_id, 'source.graph_id', row.a?.node_id);
    const targetGraph = requireString(row.g2?.graph_id, 'target.graph_id', row.b?.node_id);
    if (sourceGraph !== targetGraph) {
      // W4 — skip + warn instead of silently merging into one graph.
      // eslint-disable-next-line no-console
      console.warn(
        `migration: cross-graph relation skipped — ` +
          JSON.stringify({
            source_id: row.a.node_id,
            target_id: row.b.node_id,
            source_graph: sourceGraph,
            target_graph: targetGraph,
            relation_type: row.type,
          }),
      );
      continue;
    }
    if (Number(row.edge_count) > 1) {
      // W1 — multi-edge collapse. The PG unique constraint will keep one
      // row; warn so operators can audit which properties were lost.
      // eslint-disable-next-line no-console
      console.warn(
        `migration: multi-edge collapse — ` +
          JSON.stringify({
            source_id: row.a.node_id,
            target_id: row.b.node_id,
            relation_type: row.type,
            count: Number(row.edge_count),
          }),
      );
    }
    acceptedRels.push(row);
  }

  for (const batch of chunk(acceptedRels, BATCH_SIZE)) {
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const row of batch) {
      const sourceId = requireString(row.a?.node_id, 'source_id', row.a?.node_id ?? '<unknown>');
      const targetId = requireString(row.b?.node_id, 'target_id', row.b?.node_id ?? '<unknown>');
      const graphId = requireString(row.g?.graph_id, 'graph_id', sourceId);
      const relationType = requireString(row.type, 'relation_type', `${sourceId}->${targetId}`);
      const create = {
        source_id: sourceId,
        target_id: targetId,
        graph_id: graphId,
        relation_type: relationType,
        status: optionalString(row.r.status) ?? 'approved',
        confidence: optionalNumber(row.r.confidence) ?? 1.0,
        description: optionalString(row.r.description) ?? null,
        ai_job_id: optionalString(row.r.ai_job_id) ?? null,
      };
      const update = {
        status: optionalString(row.r.status) ?? 'approved',
        confidence: optionalNumber(row.r.confidence) ?? 1.0,
        description: optionalString(row.r.description) ?? null,
      };
      ops.push(
        prisma.relation.upsert({
          where: {
            relations_unique_edge: {
              source_id: sourceId,
              target_id: targetId,
              relation_type: relationType,
            },
          },
          create,
          update,
        }),
      );
    }
    await prisma.$transaction(ops);
  }

  return {
    graphs: graphs.length,
    nodes: nodes.length,
    relations: acceptedRels.length,
  };
}

/**
 * Throw a clearly-labelled error if a required field is missing or not a
 * string. Surfaces bad source data with location, instead of letting Prisma
 * fail a few stack frames later with a generic "Argument X is missing".
 */
export function requireString(v: unknown, field: string, recordId?: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    const idPart = recordId ? ` for record ${recordId}` : '';
    throw new Error(
      `migration: missing required field ${field}${idPart} (got ${describe(v)})`,
    );
  }
  return v;
}

function optionalString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== 'string') return undefined;
  return v;
}

function optionalNumber(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== 'number' || Number.isNaN(v)) return undefined;
  return v;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  return typeof v;
}

/**
 * Validate that `tags` is a real array (Neo4j may legitimately return
 * primitive strings for legacy data). Non-arrays warn + default to [].
 */
function normalizeTags(v: unknown, nodeId: string): Prisma.InputJsonValue {
  if (Array.isArray(v)) return v as Prisma.InputJsonValue;
  if (v === null || v === undefined) return [];
  // eslint-disable-next-line no-console
  console.warn(
    `migration: node ${nodeId} tags is not an array (got ${describe(v)}); defaulting to []`,
  );
  return [];
}

/** Split an array into fixed-size chunks. Last chunk may be shorter. */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be > 0');
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function mapGraph(g: Record<string, unknown>) {
  const graphId = requireString(g.graph_id, 'graph_id');
  return {
    graph_id: graphId,
    graph_name: requireString(g.graph_name, 'graph_name', graphId),
    graph_type: requireString(g.graph_type, 'graph_type', graphId),
    subject: optionalString(g.subject) ?? null,
    course_name: optionalString(g.course_name) ?? null,
    description: optionalString(g.description) ?? null,
    status: optionalString(g.status) ?? 'active',
    created_by: optionalString(g.created_by) ?? null,
  };
}

function mapNode(n: Record<string, unknown>) {
  const nodeId = requireString(n.node_id, 'node_id');
  return {
    node_id: nodeId,
    graph_id: requireString(n.graph_id, 'graph_id', nodeId),
    node_type: requireString(n.node_type, 'node_type', nodeId),
    knowledge_type: optionalString(n.knowledge_type) ?? null,
    name: requireString(n.name, 'name', nodeId),
    description: optionalString(n.description) ?? null,
    status: optionalString(n.status) ?? 'approved',
    source: optionalString(n.source) ?? 'manual',
    confidence: optionalNumber(n.confidence) ?? 1.0,
    tags: normalizeTags(n.tags, nodeId),
    ai_job_id: optionalString(n.ai_job_id) ?? null,
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
