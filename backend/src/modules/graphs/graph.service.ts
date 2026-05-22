import { z } from 'zod';
import { GraphType, generateGraphId } from '@mkg/shared';
import { runQuery } from '../../lib/neo4j.js';
import { prisma } from '../../lib/prisma.js';
import { getStorageBackend } from '../../lib/storage-backend.js';

/**
 * Server-side input schema for creating a graph.
 *
 * `created_by` is injected by the route layer from the JWT, so the body shape
 * the client sends is `CreateGraphSchema.omit({ created_by: true })`.
 */
export const CreateGraphSchema = z.object({
  graph_name: z.string().min(1).max(100),
  graph_type: GraphType,
  subject: z.string().max(50).optional(),
  course_name: z.string().max(100).optional(),
  description: z.string().optional(),
  created_by: z.string().min(1),
});
export type CreateGraphInput = z.infer<typeof CreateGraphSchema>;

export const UpdateGraphSchema = z
  .object({
    graph_name: z.string().min(1).max(100).optional(),
    graph_type: GraphType.optional(),
    subject: z.string().max(50).optional(),
    course_name: z.string().max(100).optional(),
    description: z.string().optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .strict();
export type UpdateGraphInput = z.infer<typeof UpdateGraphSchema>;

export interface GraphRecord {
  graph_id: string;
  graph_name: string;
  graph_type: string;
  subject?: string;
  course_name?: string;
  description?: string;
  status: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  node_count: number;
  relation_count: number;
}

export interface GraphDetail {
  graph: GraphRecord;
  nodes: Array<Record<string, unknown>>;
  relations: Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Neo4j implementation (legacy fallback — preserved verbatim)
// ---------------------------------------------------------------------------

const GraphServiceNeo4j = {
  async create(input: CreateGraphInput): Promise<GraphRecord> {
    const graph_id = generateGraphId();
    const now = new Date().toISOString();
    const props: Record<string, unknown> = {
      graph_id,
      graph_name: input.graph_name,
      graph_type: input.graph_type,
      status: 'active',
      created_at: now,
      created_by: input.created_by,
    };
    if (input.subject !== undefined) props.subject = input.subject;
    if (input.course_name !== undefined) props.course_name = input.course_name;
    if (input.description !== undefined) props.description = input.description;

    const rows = await runQuery<{ g: Record<string, unknown> }>(
      'CREATE (g:Graph $props) RETURN g { .* } AS g',
      { props },
    );
    const g = rows[0]?.g ?? {};
    return { ...(g as object), node_count: 0, relation_count: 0 } as GraphRecord;
  },

  async list(): Promise<GraphRecord[]> {
    const rows = await runQuery<{
      g: Record<string, unknown>;
      nc: number;
      rc: number;
    }>(
      `MATCH (g:Graph)
       OPTIONAL MATCH (g)<-[:BELONGS_TO_GRAPH]-(n:Node)
       WITH g, count(DISTINCT n) AS nc
       OPTIONAL MATCH (a:Node)-[r]->(b:Node)
         WHERE (a)-[:BELONGS_TO_GRAPH]->(g)
           AND (b)-[:BELONGS_TO_GRAPH]->(g)
           AND type(r) <> 'BELONGS_TO_GRAPH'
       RETURN g { .* } AS g, nc, count(r) AS rc
       ORDER BY g.created_at DESC`,
    );
    return rows.map((r) => ({
      ...(r.g as object),
      node_count: Number(r.nc ?? 0),
      relation_count: Number(r.rc ?? 0),
    })) as GraphRecord[];
  },

  async findById(graph_id: string): Promise<GraphDetail | null> {
    const meta = await runQuery<{
      g: Record<string, unknown>;
      nc: number;
      rc: number;
    }>(
      `MATCH (g:Graph {graph_id: $graph_id})
       OPTIONAL MATCH (g)<-[:BELONGS_TO_GRAPH]-(n:Node)
       WITH g, count(DISTINCT n) AS nc
       OPTIONAL MATCH (a:Node)-[r]->(b:Node)
         WHERE (a)-[:BELONGS_TO_GRAPH]->(g)
           AND (b)-[:BELONGS_TO_GRAPH]->(g)
           AND type(r) <> 'BELONGS_TO_GRAPH'
       RETURN g { .* } AS g, nc, count(r) AS rc`,
      { graph_id },
    );
    if (!meta[0]) return null;

    const nodes = await runQuery<{ n: Record<string, unknown> }>(
      `MATCH (g:Graph {graph_id: $graph_id})<-[:BELONGS_TO_GRAPH]-(n:Node)
       RETURN n { .* } AS n
       ORDER BY n.created_at ASC`,
      { graph_id },
    );

    const relations = await runQuery<{
      r: Record<string, unknown>;
      type: string;
      sid: string;
      tid: string;
      rid: number | string;
    }>(
      `MATCH (g:Graph {graph_id: $graph_id})
       MATCH (a:Node)-[r]->(b:Node)
       WHERE (a)-[:BELONGS_TO_GRAPH]->(g)
         AND (b)-[:BELONGS_TO_GRAPH]->(g)
         AND type(r) <> 'BELONGS_TO_GRAPH'
       RETURN r { .* } AS r, type(r) AS type,
              a.node_id AS sid, b.node_id AS tid, id(r) AS rid`,
      { graph_id },
    );

    return {
      graph: {
        ...(meta[0]!.g as object),
        node_count: Number(meta[0]!.nc ?? 0),
        relation_count: Number(meta[0]!.rc ?? 0),
      } as GraphRecord,
      nodes: nodes.map((x) => x.n),
      relations: relations.map((x) => ({
        ...(x.r as object),
        relation_id: String(x.rid),
        relation_type: x.type,
        source_id: x.sid,
        target_id: x.tid,
      })),
    };
  },

  async update(
    graph_id: string,
    patch: UpdateGraphInput,
  ): Promise<GraphRecord | null> {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) cleaned[k] = v;
    }
    if (Object.keys(cleaned).length === 0) {
      const detail = await GraphServiceNeo4j.findById(graph_id);
      return detail?.graph ?? null;
    }
    const rows = await runQuery<{ g: Record<string, unknown> }>(
      `MATCH (g:Graph {graph_id: $graph_id})
       SET g += $patch, g.updated_at = datetime()
       RETURN g { .* } AS g`,
      { graph_id, patch: cleaned },
    );
    if (!rows[0]) return null;
    const detail = await GraphServiceNeo4j.findById(graph_id);
    return detail?.graph ?? null;
  },

  async remove(graph_id: string): Promise<boolean> {
    await runQuery(
      `MATCH (g:Graph {graph_id: $graph_id})<-[:BELONGS_TO_GRAPH]-(n:Node)
       DETACH DELETE n`,
      { graph_id },
    );
    const rows = await runQuery<{ deleted: number }>(
      `MATCH (g:Graph {graph_id: $graph_id})
       WITH g, 1 AS marker
       DETACH DELETE g
       RETURN count(marker) AS deleted`,
      { graph_id },
    );
    return Number(rows[0]?.deleted ?? 0) > 0;
  },

  async exportToJson(graph_id: string): Promise<GraphDetail | null> {
    return GraphServiceNeo4j.findById(graph_id);
  },
};

// ---------------------------------------------------------------------------
// Postgres / Prisma implementation
// ---------------------------------------------------------------------------

/**
 * Convert a Prisma Graph row into the public GraphRecord shape.
 *
 * - `created_at` / `updated_at` are emitted as ISO strings to keep the API
 *   response identical to the Neo4j-era serialization (driver returned
 *   neo4j.DateTime → toString() → ISO).
 * - Nullable text columns are dropped when null so the JSON payload is
 *   shorter and matches the legacy "absent" semantics rather than carrying
 *   null bombs to the frontend.
 */
function toGraphRecord(
  g: {
    graph_id: string;
    graph_name: string;
    graph_type: string;
    subject: string | null;
    course_name: string | null;
    description: string | null;
    status: string;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
  },
  nodeCount: number,
  relationCount: number,
): GraphRecord {
  const out: GraphRecord = {
    graph_id: g.graph_id,
    graph_name: g.graph_name,
    graph_type: g.graph_type,
    status: g.status,
    node_count: nodeCount,
    relation_count: relationCount,
  };
  if (g.subject !== null) out.subject = g.subject;
  if (g.course_name !== null) out.course_name = g.course_name;
  if (g.description !== null) out.description = g.description;
  if (g.created_by !== null) out.created_by = g.created_by;
  out.created_at = g.created_at.toISOString();
  out.updated_at = g.updated_at.toISOString();
  return out;
}

const GraphServicePg = {
  async create(input: CreateGraphInput): Promise<GraphRecord> {
    const graph_id = generateGraphId();
    const created = await prisma.graph.create({
      data: {
        graph_id,
        graph_name: input.graph_name,
        graph_type: input.graph_type,
        subject: input.subject ?? null,
        course_name: input.course_name ?? null,
        description: input.description ?? null,
        created_by: input.created_by,
      },
    });
    return toGraphRecord(created, 0, 0);
  },

  async list(): Promise<GraphRecord[]> {
    // One round-trip: graph row + counts via lateral correlated subquery.
    // Plain prisma.graph.findMany + per-row count would be N+1.
    const rows = await prisma.$queryRaw<
      Array<{
        graph_id: string;
        graph_name: string;
        graph_type: string;
        subject: string | null;
        course_name: string | null;
        description: string | null;
        status: string;
        created_by: string | null;
        created_at: Date;
        updated_at: Date;
        node_count: bigint;
        relation_count: bigint;
      }>
    >`
      SELECT g.graph_id, g.graph_name, g.graph_type, g.subject, g.course_name,
             g.description, g.status, g.created_by, g.created_at, g.updated_at,
             COALESCE(nc.cnt, 0)::bigint AS node_count,
             COALESCE(rc.cnt, 0)::bigint AS relation_count
      FROM graphs g
      LEFT JOIN (SELECT graph_id, COUNT(*) AS cnt FROM nodes GROUP BY graph_id) nc
        ON nc.graph_id = g.graph_id
      LEFT JOIN (SELECT graph_id, COUNT(*) AS cnt FROM relations GROUP BY graph_id) rc
        ON rc.graph_id = g.graph_id
      ORDER BY g.created_at DESC
    `;
    return rows.map((r) =>
      toGraphRecord(r, Number(r.node_count), Number(r.relation_count)),
    );
  },

  async findById(graph_id: string): Promise<GraphDetail | null> {
    const g = await prisma.graph.findUnique({ where: { graph_id } });
    if (!g) return null;
    const [nodes, relations] = await Promise.all([
      prisma.node.findMany({
        where: { graph_id },
        orderBy: { created_at: 'asc' },
      }),
      prisma.relation.findMany({
        where: { graph_id },
        orderBy: { created_at: 'asc' },
      }),
    ]);
    return {
      graph: toGraphRecord(g, nodes.length, relations.length),
      nodes: nodes.map(toPlainNode),
      relations: relations.map(toPlainRelation),
    };
  },

  async update(
    graph_id: string,
    patch: UpdateGraphInput,
  ): Promise<GraphRecord | null> {
    // Drop `undefined` so Prisma does not interpret them as "set to null".
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) data[k] = v;
    }
    // No-op patch returns current state with counts (matches Cypher path).
    if (Object.keys(data).length === 0) {
      const detail = await GraphServicePg.findById(graph_id);
      return detail?.graph ?? null;
    }
    try {
      await prisma.graph.update({ where: { graph_id }, data });
    } catch (err) {
      // Prisma throws P2025 when the row is missing — return null per contract.
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === 'P2025'
      ) {
        return null;
      }
      throw err;
    }
    const detail = await GraphServicePg.findById(graph_id);
    return detail?.graph ?? null;
  },

  async remove(graph_id: string): Promise<boolean> {
    // FK has ON DELETE CASCADE for nodes & relations, so a single delete
    // tears down the whole subtree. Catch P2025 to mirror the boolean return.
    try {
      await prisma.graph.delete({ where: { graph_id } });
      return true;
    } catch (err) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === 'P2025'
      ) {
        return false;
      }
      throw err;
    }
  },

  async exportToJson(graph_id: string): Promise<GraphDetail | null> {
    return GraphServicePg.findById(graph_id);
  },
};

/**
 * Reshape a Prisma `Node` row into the loose `Record<string, unknown>` shape
 * the routes return. Drops nulls (matches Cypher), serializes timestamps to
 * ISO strings, and strips the `embedding` column (binary, never sent over
 * the wire — Pack C uses it server-side only).
 */
function toPlainNode(n: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (k === 'embedding') continue;
    if (v === null) continue;
    if (v instanceof Date) {
      out[k] = v.toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Reshape a Prisma `Relation` row to match the legacy Neo4j contract:
 * - `relation_id` is a numeric string (BigInt → String).
 * - timestamps as ISO strings.
 * - nulls dropped.
 */
function toPlainRelation(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (v === null) continue;
    if (k === 'relation_id') {
      out[k] = typeof v === 'bigint' ? v.toString() : String(v);
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public proxy — picks an implementation per call so tests that toggle
// STORAGE_BACKEND between cases see the right backend without a process
// restart. All public method signatures are identical to the legacy export.
// ---------------------------------------------------------------------------

function impl() {
  return getStorageBackend() === 'pg' ? GraphServicePg : GraphServiceNeo4j;
}

export const GraphService = {
  create: (input: CreateGraphInput) => impl().create(input),
  list: () => impl().list(),
  findById: (graph_id: string) => impl().findById(graph_id),
  update: (graph_id: string, patch: UpdateGraphInput) =>
    impl().update(graph_id, patch),
  remove: (graph_id: string) => impl().remove(graph_id),
  exportToJson: (graph_id: string) => impl().exportToJson(graph_id),
};
