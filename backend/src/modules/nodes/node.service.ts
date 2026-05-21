import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  NodeCreateInput,
  NodeUpdateInput,
  NodeType,
  NodeStatus,
} from '@mkg/shared';
import { runQuery } from '../../lib/neo4j.js';
import { prisma } from '../../lib/prisma.js';
import { getStorageBackend } from '../../lib/storage-backend.js';
import { generateNodeId } from '../../services/neo4j/id.js';

/**
 * NodeListQuery — query string contract for `GET /api/graphs/:id/nodes`.
 *
 * `keyword` is fed through Cypher with parameter binding only — never
 * concatenated — to keep injection out of reach. Pagination caps at 200
 * to avoid accidental "give me everything" hits on large graphs.
 */
export const NodeListQuery = z.object({
  node_type: NodeType.optional(),
  status: NodeStatus.optional(),
  keyword: z.string().min(1).max(100).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type NodeListQuery = z.infer<typeof NodeListQuery>;

export interface NodeListResult {
  items: Array<Record<string, unknown>>;
  total: number;
  skip: number;
  limit: number;
}

export interface BatchOptions {
  ai_job_id?: string;
  status?: z.infer<typeof NodeStatus>;
  source?: 'manual' | 'ai_generated' | 'imported';
}

/**
 * Strip undefined values so they do not overwrite existing properties when
 * Cypher does `n += $patch`.
 */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

// ---------------------------------------------------------------------------
// Pack C hook surface
// ---------------------------------------------------------------------------
//
// Pack C will register an embedding-write callback here so newly created /
// updated nodes get an OpenAI embedding without coupling NodeService to the
// embedding module. The default is a no-op so Pack B alone has no behavior
// change. The hook is fire-and-forget on purpose — it must not block user
// requests if OpenAI is slow or down (Pack C uses an internal queue).
//
// `was_created` lets Pack C skip re-embedding nodes whose content didn't
// change: on a pure ON MATCH update where name / description are unchanged,
// the embedding is identical and the OpenAI call would be wasted. Each call
// site of `fireNodeUpserted` MUST pass an accurate value:
//   - create()       → true
//   - update()       → false
//   - createBatch()  → per row, derived from a pre-write existence probe
//                      (timestamp comparison is unreliable because Prisma's
//                      @updatedAt is client-generated and @default(now()) is
//                      server-generated — they never match exactly).

type NodeUpsertedHook = (node: {
  node_id: string;
  name: string;
  description?: string | null;
  tags?: unknown;
  was_created: boolean;
}) => void;

let nodeUpsertedHook: NodeUpsertedHook | null = null;

/**
 * Pack C uses this to subscribe. Setting null detaches.
 */
export function setNodeUpsertedHook(hook: NodeUpsertedHook | null): void {
  nodeUpsertedHook = hook;
}

function fireNodeUpserted(
  n: Record<string, unknown>,
  was_created: boolean,
): void {
  if (!nodeUpsertedHook) return;
  if (typeof n.node_id !== 'string' || typeof n.name !== 'string') return;
  try {
    nodeUpsertedHook({
      node_id: n.node_id,
      name: n.name,
      description: (n.description as string | null | undefined) ?? null,
      tags: n.tags,
      was_created,
    });
  } catch {
    // Hook errors must not break the main write path.
  }
}

// ---------------------------------------------------------------------------
// Neo4j implementation (legacy fallback — preserved verbatim apart from the
// hook calls).
// ---------------------------------------------------------------------------

const NodeServiceCrudNeo4j = {
  async create(
    graph_id: string,
    input: z.infer<typeof NodeCreateInput> & Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const exists = await runQuery<{ c: number }>(
      'MATCH (g:Graph {graph_id: $graph_id}) RETURN count(g) AS c',
      { graph_id },
    );
    if (Number(exists[0]?.c ?? 0) === 0) return null;

    const node_id =
      (typeof input.node_id === 'string' && input.node_id) ||
      generateNodeId(input.node_type);
    const now = new Date().toISOString();

    const props = compact({
      ...input,
      node_id,
      status: input.status ?? 'candidate',
      source: input.source ?? 'manual',
      tags: (input.tags && typeof input.tags === 'object')
        ? (input.tags as Record<string, unknown> | unknown[])
        : {},
      created_at: now,
    });

    const rows = await runQuery<{ n: Record<string, unknown> }>(
      `MATCH (g:Graph {graph_id: $graph_id})
       CREATE (n:Node $props)
       MERGE (n)-[:BELONGS_TO_GRAPH]->(g)
       RETURN n { .* } AS n`,
      { graph_id, props },
    );
    const n = rows[0]?.n ?? null;
    if (n) fireNodeUpserted(n, true);
    return n;
  },

  async list(graph_id: string, q: NodeListQuery): Promise<NodeListResult> {
    const filters: string[] = [];
    const params: Record<string, unknown> = {
      graph_id,
      skip: q.skip,
      limit: q.limit,
    };
    if (q.node_type) {
      filters.push('n.node_type = $node_type');
      params.node_type = q.node_type;
    }
    if (q.status) {
      filters.push('n.status = $status');
      params.status = q.status;
    }
    if (q.keyword) {
      filters.push('toLower(n.name) CONTAINS toLower($keyword)');
      params.keyword = q.keyword;
    }
    const whereExtra = filters.length ? ' AND ' + filters.join(' AND ') : '';

    const items = await runQuery<{ n: Record<string, unknown> }>(
      `MATCH (g:Graph {graph_id: $graph_id})<-[:BELONGS_TO_GRAPH]-(n:Node)
       WHERE 1=1${whereExtra}
       RETURN n { .* } AS n
       ORDER BY n.created_at DESC
       SKIP $skip LIMIT $limit`,
      params,
      { mode: 'READ' },
    );

    const totalRows = await runQuery<{ total: number }>(
      `MATCH (g:Graph {graph_id: $graph_id})<-[:BELONGS_TO_GRAPH]-(n:Node)
       WHERE 1=1${whereExtra}
       RETURN count(n) AS total`,
      params,
      { mode: 'READ' },
    );

    return {
      items: items.map((x) => x.n),
      total: Number(totalRows[0]?.total ?? 0),
      skip: q.skip,
      limit: q.limit,
    };
  },

  async findById(node_id: string): Promise<Record<string, unknown> | null> {
    const rows = await runQuery<{ n: Record<string, unknown> }>(
      'MATCH (n:Node {node_id: $node_id}) RETURN n { .* } AS n',
      { node_id },
    );
    return rows[0]?.n ?? null;
  },

  async update(
    node_id: string,
    patch: z.infer<typeof NodeUpdateInput> & Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const cleaned = compact(patch) as Record<string, unknown>;
    delete cleaned.node_id;
    delete cleaned.node_type;
    delete cleaned.created_at;
    delete cleaned.created_by;
    if (Object.keys(cleaned).length === 0) {
      return NodeServiceCrudNeo4j.findById(node_id);
    }
    const rows = await runQuery<{ n: Record<string, unknown> }>(
      `MATCH (n:Node {node_id: $node_id})
       SET n += $patch, n.updated_at = datetime()
       RETURN n { .* } AS n`,
      { node_id, patch: cleaned },
    );
    const n = rows[0]?.n ?? null;
    if (n) fireNodeUpserted(n, false);
    return n;
  },

  async remove(node_id: string): Promise<boolean> {
    const rows = await runQuery<{ deleted: number }>(
      `MATCH (n:Node {node_id: $node_id})
       WITH n, 1 AS marker
       DETACH DELETE n
       RETURN count(marker) AS deleted`,
      { node_id },
    );
    return Number(rows[0]?.deleted ?? 0) > 0;
  },

  async batchApprove(node_ids: string[]): Promise<{ updated: number }> {
    if (node_ids.length === 0) return { updated: 0 };
    const rows = await runQuery<{ updated: number }>(
      `UNWIND $node_ids AS nid
       MATCH (n:Node {node_id: nid})
       SET n.status = 'approved', n.updated_at = datetime()
       RETURN count(n) AS updated`,
      { node_ids },
    );
    return { updated: Number(rows[0]?.updated ?? 0) };
  },
};

const NodeServiceBatchNeo4j = {
  async createBatch(
    graphId: string,
    inputs: Array<Record<string, unknown>>,
    opts: BatchOptions = {},
  ): Promise<Array<Record<string, unknown>>> {
    if (inputs.length === 0) return [];
    const now = new Date().toISOString();
    const nodes = inputs.map((n) => {
      const node_type = n.node_type as Parameters<typeof generateNodeId>[0];
      return compact({
        ...n,
        node_id:
          (typeof n.node_id === 'string' && n.node_id) ||
          generateNodeId(node_type),
        status: opts.status ?? n.status ?? 'candidate',
        source: opts.source ?? n.source ?? 'ai_generated',
        ai_job_id: opts.ai_job_id ?? n.ai_job_id,
        tags: Array.isArray(n.tags) ? n.tags : [],
        created_at: now,
      });
    });

    // Probe which ids already exist before the MERGE so we can report
    // was_created accurately per row to the Pack C hook.
    const ids = nodes.map((n) => n.node_id as string);
    const preProbe = await runQuery<{ node_id: string }>(
      `MATCH (n:Node) WHERE n.node_id IN $ids RETURN n.node_id AS node_id`,
      { ids },
    );
    const existedBefore = new Set(preProbe.map((r) => r.node_id));

    await runQuery(
      `MATCH (g:Graph {graph_id: $graphId})
       UNWIND $nodes AS node
       MERGE (n:Node {node_id: node.node_id})
         ON CREATE SET n = node
         ON MATCH SET n += node, n.updated_at = datetime()
       MERGE (n)-[:BELONGS_TO_GRAPH]->(g)`,
      { nodes, graphId },
    );
    for (const n of nodes) {
      const was_created = !existedBefore.has(n.node_id as string);
      fireNodeUpserted(n as Record<string, unknown>, was_created);
    }
    return nodes as Array<Record<string, unknown>>;
  },

  async bulkUpdateStatusByJob(
    graphId: string,
    aiJobId: string,
    status: z.infer<typeof NodeStatus>,
  ): Promise<number> {
    const rows = await runQuery<{ updated: number }>(
      `MATCH (n:Node {ai_job_id: $aiJobId})-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
       SET n.status = $status, n.updated_at = datetime()
       RETURN count(n) AS updated`,
      { graphId, aiJobId, status },
    );
    return Number(rows[0]?.updated ?? 0);
  },

  async bulkUpdateStatusByIds(
    graphId: string,
    nodeIds: string[],
    status: z.infer<typeof NodeStatus>,
  ): Promise<number> {
    if (nodeIds.length === 0) return 0;
    const rows = await runQuery<{ updated: number }>(
      `UNWIND $ids AS id
       MATCH (n:Node {node_id: id})-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
       SET n.status = $status, n.updated_at = datetime()
       RETURN count(n) AS updated`,
      { graphId, ids: nodeIds, status },
    );
    return Number(rows[0]?.updated ?? 0);
  },

  async bulkDeleteByJob(graphId: string, aiJobId: string): Promise<number> {
    const rows = await runQuery<{ deleted: number }>(
      `MATCH (n:Node {ai_job_id: $aiJobId, status: 'candidate'})
         -[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
       WITH n, 1 AS marker
       DETACH DELETE n
       RETURN count(marker) AS deleted`,
      { graphId, aiJobId },
    );
    return Number(rows[0]?.deleted ?? 0);
  },

  async listByAiJob(
    graphId: string,
    aiJobId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const rows = await runQuery<{ n: Record<string, unknown> }>(
      `MATCH (n:Node {ai_job_id: $aiJobId})-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
       RETURN n { .* } AS n
       ORDER BY n.created_at ASC`,
      { graphId, aiJobId },
    );
    return rows.map((x) => x.n);
  },
};

const NodeServiceNeo4j = { ...NodeServiceCrudNeo4j, ...NodeServiceBatchNeo4j };

// ---------------------------------------------------------------------------
// Postgres / Prisma implementation
// ---------------------------------------------------------------------------

/**
 * Maximum number of rows per single `prisma.$transaction([...])` call inside
 * `createBatch`. Postgres' `max_prepared_statements` (default 100, often
 * raised to a few thousand) is shared across the whole transaction; sending
 * 5k+ upserts in one shot has been observed to trip the limit on AI-generated
 * runs. Atomicity becomes per-chunk rather than per-call — Pack C / Agent-C
 * already retry the whole job on failure, so this is acceptable.
 */
const BATCH_CHUNK_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Columns that the `nodes` table actually owns. Anything else AI / API input
 * carries (step_order, phase, aliases, evidence, key_action, ...) is folded
 * into the `tags` JSON column by `pickNodeColumns` so v2 prompts can ride
 * with rich metadata without a schema migration per field. Adding new top-
 * level columns is a Prisma schema migration, not a service change.
 */
const NODE_COLUMNS = new Set([
  'node_id',
  'graph_id',
  'node_type',
  'knowledge_type',
  'name',
  'description',
  'status',
  'source',
  'confidence',
  'tags',
  'ai_job_id',
]);

/**
 * Project the input object onto the table's column whitelist, while folding
 * non-column keys into `tags` so they are preserved as JSON instead of being
 * silently dropped at the Postgres boundary. Legacy `tags: string[]` shapes
 * are preserved under `_legacy` (the upstream `mapLLMOutput` does the same).
 *
 * `tags` is always emitted as an object — never undefined — so callers can
 * assign it to a `Prisma.InputJsonValue` field without further clamping.
 */
function pickNodeColumns(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (k === 'tags') continue; // handled after the loop
    if (NODE_COLUMNS.has(k)) out[k] = v;
    else extras[k] = v;
  }
  const baseTags =
    Array.isArray(input.tags)
      ? { _legacy: input.tags as unknown[] }
      : input.tags && typeof input.tags === 'object'
        ? (input.tags as Record<string, unknown>)
        : {};
  out.tags = { ...baseTags, ...extras };
  return out;
}

/**
 * Convert a Prisma `Node` row to the loose Record the routes return.
 * Drops nulls (legacy Cypher omitted absent props), serializes Date columns
 * to ISO strings, and strips the binary `embedding` column.
 */
function toPlainNode(n: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (k === 'embedding') continue;
    if (v === null || v === undefined) continue;
    if (v instanceof Date) {
      out[k] = v.toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

const NodeServicePg = {
  async create(
    graph_id: string,
    input: z.infer<typeof NodeCreateInput> & Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    // Mirror the Cypher path: missing graph returns null instead of throwing.
    const graphExists = await prisma.graph.findUnique({
      where: { graph_id },
      select: { graph_id: true },
    });
    if (!graphExists) return null;

    const node_id =
      (typeof input.node_id === 'string' && input.node_id) ||
      generateNodeId(input.node_type);
    const data = {
      ...pickNodeColumns(input),
      node_id,
      graph_id,
      status: (input.status as string | undefined) ?? 'candidate',
      source: (input.source as string | undefined) ?? 'manual',
    } as unknown as Prisma.NodeUncheckedCreateInput;

    const created = await prisma.node.create({ data });
    const plain = toPlainNode(created as unknown as Record<string, unknown>);
    fireNodeUpserted(plain, true);
    return plain;
  },

  async list(graph_id: string, q: NodeListQuery): Promise<NodeListResult> {
    const where: Prisma.NodeWhereInput = { graph_id };
    if (q.node_type) where.node_type = q.node_type;
    if (q.status) where.status = q.status;
    if (q.keyword) where.name = { contains: q.keyword, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      prisma.node.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: q.skip,
        take: q.limit,
      }),
      prisma.node.count({ where }),
    ]);

    return {
      items: items.map((n) => toPlainNode(n as unknown as Record<string, unknown>)),
      total,
      skip: q.skip,
      limit: q.limit,
    };
  },

  async findById(node_id: string): Promise<Record<string, unknown> | null> {
    const n = await prisma.node.findUnique({ where: { node_id } });
    if (!n) return null;
    return toPlainNode(n as unknown as Record<string, unknown>);
  },

  async update(
    node_id: string,
    patch: z.infer<typeof NodeUpdateInput> & Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    // Forbid mutating identity / type — the discriminated unions in @mkg/shared
    // depend on these being fixed once a node exists.
    const cleaned = pickNodeColumns(patch);
    delete cleaned.node_id;
    delete cleaned.node_type;
    delete cleaned.graph_id;
    if (Object.keys(cleaned).length === 0) {
      return NodeServicePg.findById(node_id);
    }
    try {
      const updated = await prisma.node.update({
        where: { node_id },
        data: cleaned as Prisma.NodeUncheckedUpdateInput,
      });
      const plain = toPlainNode(updated as unknown as Record<string, unknown>);
      fireNodeUpserted(plain, false);
      return plain;
    } catch (err) {
      if (isP2025(err)) return null;
      throw err;
    }
  },

  async remove(node_id: string): Promise<boolean> {
    try {
      await prisma.node.delete({ where: { node_id } });
      return true;
    } catch (err) {
      if (isP2025(err)) return false;
      throw err;
    }
  },

  async batchApprove(node_ids: string[]): Promise<{ updated: number }> {
    if (node_ids.length === 0) return { updated: 0 };
    const res = await prisma.node.updateMany({
      where: { node_id: { in: node_ids } },
      data: { status: 'approved' },
    });
    return { updated: res.count };
  },

  async createBatch(
    graphId: string,
    inputs: Array<Record<string, unknown>>,
    opts: BatchOptions = {},
  ): Promise<Array<Record<string, unknown>>> {
    if (inputs.length === 0) return [];
    const prepared = inputs.map((n) => {
      const node_type = n.node_type as Parameters<typeof generateNodeId>[0];
      const node_id =
        (typeof n.node_id === 'string' && n.node_id) ||
        generateNodeId(node_type);
      return {
        ...pickNodeColumns(n),
        node_id,
        graph_id: graphId,
        status:
          (opts.status as string | undefined) ??
          (n.status as string | undefined) ??
          'candidate',
        source:
          (opts.source as string | undefined) ??
          (n.source as string | undefined) ??
          'ai_generated',
        ai_job_id:
          (opts.ai_job_id as string | undefined) ??
          (n.ai_job_id as string | undefined),
      } as unknown as Prisma.NodeUncheckedCreateInput & Record<string, unknown>;
    });

    // Probe which ids already exist before the upsert so the Pack C hook
    // gets an accurate `was_created` per row. Timestamp comparison
    // (created_at === updated_at) doesn't work because Prisma's @updatedAt
    // is client-generated while @default(now()) is server-generated; they
    // never line up exactly even on insert.
    const allIds = prepared.map((p) => p.node_id as string);
    const existingRows = await prisma.node.findMany({
      where: { node_id: { in: allIds } },
      select: { node_id: true },
    });
    const existedBefore = new Set(existingRows.map((r) => r.node_id));

    // Run upserts in chunks of BATCH_CHUNK_SIZE so a single huge AI batch
    // doesn't trip Postgres' max_prepared_statements. Atomicity is
    // per-chunk now, not per-call — Agent-C retries on the whole job, so
    // this trade-off is acceptable.
    const upserted: Array<Record<string, unknown>> = [];
    for (const slice of chunk(prepared, BATCH_CHUNK_SIZE)) {
      const written = await prisma.$transaction(
        slice.map((data) =>
          prisma.node.upsert({
            where: { node_id: data.node_id! },
            create: data,
            update: {
              // ON MATCH SET n += node — only mutable fields, never identity.
              name: data.name as string,
              description: (data.description as string | null | undefined) ?? null,
              knowledge_type:
                (data.knowledge_type as string | null | undefined) ?? null,
              status: data.status as string,
              source: data.source as string,
              confidence: (data.confidence as number | undefined) ?? 1.0,
              tags: data.tags as Prisma.InputJsonValue,
              ai_job_id: (data.ai_job_id as string | null | undefined) ?? null,
            },
          }),
        ),
      );
      for (const w of written) {
        upserted.push(w as unknown as Record<string, unknown>);
      }
    }

    const out = upserted.map((n) =>
      toPlainNode(n as unknown as Record<string, unknown>),
    );
    for (const n of out) {
      const was_created = !existedBefore.has(n.node_id as string);
      fireNodeUpserted(n, was_created);
    }
    return out;
  },

  async bulkUpdateStatusByJob(
    graphId: string,
    aiJobId: string,
    status: z.infer<typeof NodeStatus>,
  ): Promise<number> {
    const res = await prisma.node.updateMany({
      where: { graph_id: graphId, ai_job_id: aiJobId },
      data: { status },
    });
    return res.count;
  },

  async bulkUpdateStatusByIds(
    graphId: string,
    nodeIds: string[],
    status: z.infer<typeof NodeStatus>,
  ): Promise<number> {
    if (nodeIds.length === 0) return 0;
    const res = await prisma.node.updateMany({
      where: { graph_id: graphId, node_id: { in: nodeIds } },
      data: { status },
    });
    return res.count;
  },

  async bulkDeleteByJob(graphId: string, aiJobId: string): Promise<number> {
    const res = await prisma.node.deleteMany({
      where: {
        graph_id: graphId,
        ai_job_id: aiJobId,
        status: 'candidate',
      },
    });
    return res.count;
  },

  async listByAiJob(
    graphId: string,
    aiJobId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const rows = await prisma.node.findMany({
      where: { graph_id: graphId, ai_job_id: aiJobId },
      orderBy: { created_at: 'asc' },
    });
    return rows.map((n) => toPlainNode(n as unknown as Record<string, unknown>));
  },
};

function isP2025(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2025'
  );
}

// ---------------------------------------------------------------------------
// Public proxy
// ---------------------------------------------------------------------------

function impl() {
  return getStorageBackend() === 'pg' ? NodeServicePg : NodeServiceNeo4j;
}

export const NodeService = {
  create: (
    graph_id: string,
    input: z.infer<typeof NodeCreateInput> & Record<string, unknown>,
  ) => impl().create(graph_id, input),
  list: (graph_id: string, q: NodeListQuery) => impl().list(graph_id, q),
  findById: (node_id: string) => impl().findById(node_id),
  update: (
    node_id: string,
    patch: z.infer<typeof NodeUpdateInput> & Record<string, unknown>,
  ) => impl().update(node_id, patch),
  remove: (node_id: string) => impl().remove(node_id),
  batchApprove: (node_ids: string[]) => impl().batchApprove(node_ids),
  createBatch: (
    graphId: string,
    inputs: Array<Record<string, unknown>>,
    opts: BatchOptions = {},
  ) => impl().createBatch(graphId, inputs, opts),
  bulkUpdateStatusByJob: (
    graphId: string,
    aiJobId: string,
    status: z.infer<typeof NodeStatus>,
  ) => impl().bulkUpdateStatusByJob(graphId, aiJobId, status),
  bulkUpdateStatusByIds: (
    graphId: string,
    nodeIds: string[],
    status: z.infer<typeof NodeStatus>,
  ) => impl().bulkUpdateStatusByIds(graphId, nodeIds, status),
  bulkDeleteByJob: (graphId: string, aiJobId: string) =>
    impl().bulkDeleteByJob(graphId, aiJobId),
  listByAiJob: (graphId: string, aiJobId: string) =>
    impl().listByAiJob(graphId, aiJobId),
};
export type NodeService = typeof NodeService;
