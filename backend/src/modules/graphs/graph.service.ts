import { z } from 'zod';
import { GraphType } from '@mkg/shared';
import { runQuery } from '../../lib/neo4j.js';
import { generateGraphId } from '../../services/neo4j/id.js';

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

/**
 * GraphService — Cypher access for the Graph node + its membership relations.
 *
 * All queries are parameterized; never interpolate user input into Cypher.
 */
export const GraphService = {
  async create(input: CreateGraphInput): Promise<GraphRecord> {
    const graph_id = generateGraphId();
    const now = new Date().toISOString();
    // Strip undefined to keep the stored properties tidy.
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
    // Drop undefined entries — Cypher's `+=` would otherwise overwrite stored
    // values with null.
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) cleaned[k] = v;
    }
    if (Object.keys(cleaned).length === 0) {
      const detail = await GraphService.findById(graph_id);
      return detail?.graph ?? null;
    }
    const rows = await runQuery<{ g: Record<string, unknown> }>(
      `MATCH (g:Graph {graph_id: $graph_id})
       SET g += $patch, g.updated_at = datetime()
       RETURN g { .* } AS g`,
      { graph_id, patch: cleaned },
    );
    if (!rows[0]) return null;
    // Recompute counts to keep response shape consistent.
    const detail = await GraphService.findById(graph_id);
    return detail?.graph ?? null;
  },

  async remove(graph_id: string): Promise<boolean> {
    // First detach-delete every node belonging to the graph, then the graph itself.
    // This avoids leaving orphan Node records when the graph is removed.
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
    return GraphService.findById(graph_id);
  },
};
