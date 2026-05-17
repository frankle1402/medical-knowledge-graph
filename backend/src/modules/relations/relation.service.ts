import { z } from 'zod';
import {
  Relation,
  RelationCreateInput,
  RelationType,
  NodeStatus,
} from '@mkg/shared';
import { runQuery } from '../../lib/neo4j.js';

/**
 * RelationService — Cypher access for typed relationships between Nodes.
 *
 * Neo4j relationship types cannot be parameterized, so we *whitelist* via
 * `RelationType.parse(value)` before injecting the type into the cypher
 * template literal. Any value not in the enum throws a Zod error and never
 * reaches the database. All other dynamic values flow through `$params`.
 */

export const RelationUpdateInput = z
  .object({
    description: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    status: NodeStatus.optional(),
  })
  .strict();
export type RelationUpdateInput = z.infer<typeof RelationUpdateInput>;

export interface RelationRecord extends Record<string, unknown> {
  relation_id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
}

export interface BatchRelationOptions {
  ai_job_id?: string;
  status?: z.infer<typeof NodeStatus>;
  source?: 'manual' | 'ai_generated' | 'imported';
}

function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

const RelationServiceCrud = {
  async create(
    graph_id: string,
    input: z.infer<typeof RelationCreateInput>,
  ): Promise<RelationRecord> {
    const relType = RelationType.parse(input.relation_type);
    if (relType === 'BELONGS_TO_GRAPH') {
      // Membership edges are auto-managed; never create them directly.
      throw Object.assign(new Error('BELONGS_TO_GRAPH is reserved'), {
        statusCode: 400,
      });
    }

    const props = compact({
      description: input.description ?? null,
      confidence: input.confidence ?? 1,
      status: 'approved',
      source: input.source ?? 'manual',
      ai_job_id: input.ai_job_id ?? null,
      created_at: new Date().toISOString(),
    });

    // Cypher cannot parameterize a relationship type label. RelationType.parse
    // above ensures `relType` is one of the whitelisted strings, so it is safe
    // to splice into the template.
    const rows = await runQuery<{
      r: Record<string, unknown>;
      rid: number | string;
    }>(
      `MATCH (a:Node {node_id: $source_id})-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graph_id})
       MATCH (b:Node {node_id: $target_id})-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graph_id})
       CREATE (a)-[r:${relType} $props]->(b)
       RETURN r { .* } AS r, id(r) AS rid`,
      {
        graph_id,
        source_id: input.source_id,
        target_id: input.target_id,
        props,
      },
    );
    if (rows.length === 0) {
      throw Object.assign(
        new Error('source/target nodes must both belong to the graph'),
        { statusCode: 400 },
      );
    }
    return {
      ...(rows[0]!.r as object),
      relation_id: String(rows[0]!.rid),
      relation_type: relType,
      source_id: input.source_id,
      target_id: input.target_id,
    } as RelationRecord;
  },

  async listByGraph(graph_id: string): Promise<RelationRecord[]> {
    const rows = await runQuery<{
      r: Record<string, unknown>;
      type: string;
      sid: string;
      tid: string;
      rid: number | string;
    }>(
      `MATCH (a:Node)-[r]->(b:Node)
       WHERE (a)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graph_id})
         AND (b)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graph_id})
         AND type(r) <> 'BELONGS_TO_GRAPH'
       RETURN r { .* } AS r, type(r) AS type,
              a.node_id AS sid, b.node_id AS tid, id(r) AS rid
       ORDER BY r.created_at ASC`,
      { graph_id },
      { mode: 'READ' },
    );
    return rows.map((x) => ({
      ...(x.r as object),
      relation_id: String(x.rid),
      relation_type: x.type,
      source_id: x.sid,
      target_id: x.tid,
    })) as RelationRecord[];
  },

  async update(
    relation_id: string,
    patch: RelationUpdateInput,
  ): Promise<RelationRecord | null> {
    if (!/^\d+$/.test(relation_id)) {
      throw Object.assign(new Error('invalid relation_id'), { statusCode: 400 });
    }
    const cleaned = compact(patch as Record<string, unknown>);
    if (Object.keys(cleaned).length === 0) {
      // No-op: just return current.
      const rows = await runQuery<{
        r: Record<string, unknown>;
        type: string;
        sid: string;
        tid: string;
      }>(
        `MATCH (a:Node)-[r]->(b:Node) WHERE id(r) = toInteger($rid)
         RETURN r { .* } AS r, type(r) AS type, a.node_id AS sid, b.node_id AS tid`,
        { rid: relation_id },
      );
      if (!rows[0]) return null;
      return {
        ...(rows[0].r as object),
        relation_id,
        relation_type: rows[0].type,
        source_id: rows[0].sid,
        target_id: rows[0].tid,
      } as RelationRecord;
    }
    const rows = await runQuery<{
      r: Record<string, unknown>;
      type: string;
      sid: string;
      tid: string;
    }>(
      `MATCH (a:Node)-[r]->(b:Node) WHERE id(r) = toInteger($rid)
       SET r += $patch, r.updated_at = datetime()
       RETURN r { .* } AS r, type(r) AS type, a.node_id AS sid, b.node_id AS tid`,
      { rid: relation_id, patch: cleaned },
    );
    if (!rows[0]) return null;
    return {
      ...(rows[0].r as object),
      relation_id,
      relation_type: rows[0].type,
      source_id: rows[0].sid,
      target_id: rows[0].tid,
    } as RelationRecord;
  },

  async remove(relation_id: string): Promise<boolean> {
    if (!/^\d+$/.test(relation_id)) {
      throw Object.assign(new Error('invalid relation_id'), { statusCode: 400 });
    }
    const rows = await runQuery<{ deleted: number }>(
      `MATCH ()-[r]->() WHERE id(r) = toInteger($rid)
       WITH r, 1 AS marker
       DELETE r
       RETURN count(marker) AS deleted`,
      { rid: relation_id },
    );
    return Number(rows[0]?.deleted ?? 0) > 0;
  },
};

const RelationServiceBatch = {
  /**
   * createBatch — used by Agent-C. Groups inputs by `relation_type` (since
   * Cypher can't parameterize relationship types) and runs one UNWIND per
   * group. Each `relation_type` is validated through the Zod enum first.
   */
  async createBatch(
    graphId: string,
    inputs: Array<
      Omit<z.infer<typeof Relation>, 'relation_id'> & {
        source_id: string;
        target_id: string;
        relation_type: z.infer<typeof RelationType>;
      }
    >,
    opts: BatchRelationOptions = {},
  ): Promise<number> {
    if (inputs.length === 0) return 0;
    // Group + validate.
    const groups = new Map<z.infer<typeof RelationType>, typeof inputs>();
    for (const r of inputs) {
      const t = RelationType.parse(r.relation_type);
      if (t === 'BELONGS_TO_GRAPH') continue;
      const arr = groups.get(t) ?? [];
      arr.push(r);
      groups.set(t, arr);
    }
    const now = new Date().toISOString();
    let written = 0;
    for (const [relType, items] of groups) {
      const rels = items.map((it) =>
        compact({
          source_id: it.source_id,
          target_id: it.target_id,
          description: it.description ?? null,
          confidence: it.confidence ?? 1,
          status: opts.status ?? it.status ?? 'candidate',
          source: opts.source ?? it.source ?? 'ai_generated',
          ai_job_id: opts.ai_job_id ?? it.ai_job_id ?? null,
          created_at: now,
        }),
      );
      const rows = await runQuery<{ written: number }>(
        `UNWIND $rels AS rel
         MATCH (a:Node {node_id: rel.source_id})-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
         MATCH (b:Node {node_id: rel.target_id})-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
         MERGE (a)-[r:${relType}]->(b)
           ON CREATE SET r = rel
           ON MATCH SET r += rel, r.updated_at = datetime()
         RETURN count(r) AS written`,
        { rels, graphId },
      );
      written += Number(rows[0]?.written ?? 0);
    }
    return written;
  },

  async bulkUpdateStatusByJob(
    graphId: string,
    aiJobId: string,
    status: z.infer<typeof NodeStatus>,
  ): Promise<number> {
    const rows = await runQuery<{ updated: number }>(
      `MATCH (a:Node)-[r]->(b:Node)
       WHERE r.ai_job_id = $aiJobId
         AND (a)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
         AND (b)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
         AND type(r) <> 'BELONGS_TO_GRAPH'
       SET r.status = $status, r.updated_at = datetime()
       RETURN count(r) AS updated`,
      { graphId, aiJobId, status },
    );
    return Number(rows[0]?.updated ?? 0);
  },

  async bulkDeleteByJob(graphId: string, aiJobId: string): Promise<number> {
    const rows = await runQuery<{ deleted: number }>(
      `MATCH (a:Node)-[r]->(b:Node)
       WHERE r.ai_job_id = $aiJobId
         AND r.status = 'candidate'
         AND (a)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
         AND (b)-[:BELONGS_TO_GRAPH]->(:Graph {graph_id: $graphId})
         AND type(r) <> 'BELONGS_TO_GRAPH'
       WITH r, 1 AS marker
       DELETE r
       RETURN count(marker) AS deleted`,
      { graphId, aiJobId },
    );
    return Number(rows[0]?.deleted ?? 0);
  },
};

export const RelationService = {
  ...RelationServiceCrud,
  ...RelationServiceBatch,
};
export type RelationService = typeof RelationService;
