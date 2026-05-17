import { z } from 'zod';
import {
  NodeCreateInput,
  NodeUpdateInput,
  NodeType,
  NodeStatus,
} from '@mkg/shared';
import { runQuery } from '../../lib/neo4j.js';
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

const NodeServiceCrud = {
  async create(
    graph_id: string,
    input: z.infer<typeof NodeCreateInput> & Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    // Confirm the graph exists *before* attempting the create. Without this,
    // a typo in graph_id silently produces zero matches (no error from Cypher).
    const exists = await runQuery<{ c: number }>(
      'MATCH (g:Graph {graph_id: $graph_id}) RETURN count(g) AS c',
      { graph_id },
    );
    if (Number(exists[0]?.c ?? 0) === 0) return null;

    const node_id =
      (typeof input.node_id === 'string' && input.node_id) ||
      generateNodeId(input.node_type);
    const now = new Date().toISOString();

    // Normalize props: scalars + arrays are accepted by Neo4j; nested objects
    // would silently break, so we keep them flat as defined by the shared
    // schema. Default status defers to schema default ('candidate'); routes
    // typically force 'approved' for manual creation.
    const props = compact({
      ...input,
      node_id,
      status: input.status ?? 'candidate',
      source: input.source ?? 'manual',
      tags: Array.isArray(input.tags) ? input.tags : [],
      created_at: now,
    });

    const rows = await runQuery<{ n: Record<string, unknown> }>(
      `MATCH (g:Graph {graph_id: $graph_id})
       CREATE (n:Node $props)
       MERGE (n)-[:BELONGS_TO_GRAPH]->(g)
       RETURN n { .* } AS n`,
      { graph_id, props },
    );
    return rows[0]?.n ?? null;
  },

  async list(graph_id: string, q: NodeListQuery): Promise<NodeListResult> {
    // Build a single WHERE clause from optional filters. Each variant binds
    // through parameters; the cypher string itself is constant.
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

    // Note: SKIP / LIMIT in Cypher 5 require Integer; the driver coerces
    // JS numbers automatically.
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
    // Disallow mutating identity / type so that the discriminated-union
    // invariants stay consistent.
    const cleaned = compact(patch) as Record<string, unknown>;
    delete cleaned.node_id;
    delete cleaned.node_type;
    delete cleaned.created_at;
    delete cleaned.created_by;
    if (Object.keys(cleaned).length === 0) {
      return NodeServiceCrud.findById(node_id);
    }
    const rows = await runQuery<{ n: Record<string, unknown> }>(
      `MATCH (n:Node {node_id: $node_id})
       SET n += $patch, n.updated_at = datetime()
       RETURN n { .* } AS n`,
      { node_id, patch: cleaned },
    );
    return rows[0]?.n ?? null;
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

const NodeServiceBatch = {
  /**
   * createBatch — used by Agent-C's AI pipeline. Writes N nodes in a single
   * round-trip via UNWIND, attaches them to the target graph, and returns
   * the (possibly augmented) node payloads with generated ids.
   */
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

    // Note: ON CREATE / ON MATCH split keeps idempotency for re-runs by job id.
    await runQuery(
      `MATCH (g:Graph {graph_id: $graphId})
       UNWIND $nodes AS node
       MERGE (n:Node {node_id: node.node_id})
         ON CREATE SET n = node
         ON MATCH SET n += node, n.updated_at = datetime()
       MERGE (n)-[:BELONGS_TO_GRAPH]->(g)`,
      { nodes, graphId },
    );
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

export const NodeService = { ...NodeServiceCrud, ...NodeServiceBatch };
export type NodeService = typeof NodeService;
