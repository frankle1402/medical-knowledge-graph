import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  Relation,
  RelationCreateInput,
  RelationType,
  NodeStatus,
} from '@mkg/shared';
import { runQuery } from '../../lib/neo4j.js';
import { prisma } from '../../lib/prisma.js';
import { getStorageBackend } from '../../lib/storage-backend.js';

/**
 * RelationService — typed edges between nodes.
 *
 * Both backends accept the same DTO. Neo4j stores the type as the cypher
 * relationship label; Postgres stores it in the `relation_type` column. In
 * both cases `RelationType.parse(value)` whitelists the value before any DB
 * I/O so unknown types never reach the wire.
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

// ---------------------------------------------------------------------------
// Neo4j implementation
// ---------------------------------------------------------------------------

const RelationServiceCrudNeo4j = {
  async create(
    graph_id: string,
    input: z.infer<typeof RelationCreateInput>,
  ): Promise<RelationRecord> {
    const relType = RelationType.parse(input.relation_type);
    if (relType === 'BELONGS_TO_GRAPH') {
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

const RelationServiceBatchNeo4j = {
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

const RelationServiceNeo4j = {
  ...RelationServiceCrudNeo4j,
  ...RelationServiceBatchNeo4j,
};

// ---------------------------------------------------------------------------
// Postgres / Prisma implementation
// ---------------------------------------------------------------------------

/**
 * Convert a Prisma `Relation` row into the public RelationRecord shape.
 * - relation_id is a numeric string (BigInt → String) to match the Cypher
 *   contract that stringified `id(r)`.
 * - timestamps emitted as ISO strings (Cypher returned neo4j.DateTime → ISO).
 * - nulls dropped — empty / absent properties were never serialized in
 *   Neo4j either.
 */
function toRelationRecord(r: {
  relation_id: bigint;
  graph_id: string;
  source_id: string;
  target_id: string;
  relation_type: string;
  status: string;
  confidence: number;
  description: string | null;
  ai_job_id: string | null;
  created_at: Date;
  updated_at: Date;
}): RelationRecord {
  const out: RelationRecord = {
    relation_id: r.relation_id.toString(),
    source_id: r.source_id,
    target_id: r.target_id,
    relation_type: r.relation_type,
    status: r.status,
    confidence: r.confidence,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
  if (r.description !== null) out.description = r.description;
  if (r.ai_job_id !== null) out.ai_job_id = r.ai_job_id;
  return out;
}

function isP2025(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2025'
  );
}

const RelationServicePg = {
  async create(
    graph_id: string,
    input: z.infer<typeof RelationCreateInput>,
  ): Promise<RelationRecord> {
    const relType = RelationType.parse(input.relation_type);
    if (relType === 'BELONGS_TO_GRAPH') {
      throw Object.assign(new Error('BELONGS_TO_GRAPH is reserved'), {
        statusCode: 400,
      });
    }

    // Both nodes must belong to the graph. Single round-trip check beats
    // letting Prisma fail with a less informative FK error message.
    const nodes = await prisma.node.findMany({
      where: {
        node_id: { in: [input.source_id, input.target_id] },
        graph_id,
      },
      select: { node_id: true },
    });
    const ids = new Set(nodes.map((n) => n.node_id));
    if (!ids.has(input.source_id) || !ids.has(input.target_id)) {
      throw Object.assign(
        new Error('source/target nodes must both belong to the graph'),
        { statusCode: 400 },
      );
    }

    const created = await prisma.relation.create({
      data: {
        graph_id,
        source_id: input.source_id,
        target_id: input.target_id,
        relation_type: relType,
        description: input.description ?? null,
        confidence: input.confidence ?? 1,
        status: 'approved',
        ai_job_id: input.ai_job_id ?? null,
      },
    });
    return toRelationRecord(created);
  },

  async listByGraph(graph_id: string): Promise<RelationRecord[]> {
    const rows = await prisma.relation.findMany({
      where: { graph_id },
      orderBy: { created_at: 'asc' },
    });
    return rows.map(toRelationRecord);
  },

  async update(
    relation_id: string,
    patch: RelationUpdateInput,
  ): Promise<RelationRecord | null> {
    if (!/^\d+$/.test(relation_id)) {
      throw Object.assign(new Error('invalid relation_id'), { statusCode: 400 });
    }
    const id = BigInt(relation_id);
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) cleaned[k] = v;
    }
    if (Object.keys(cleaned).length === 0) {
      const r = await prisma.relation.findUnique({ where: { relation_id: id } });
      return r ? toRelationRecord(r) : null;
    }
    try {
      const updated = await prisma.relation.update({
        where: { relation_id: id },
        data: cleaned as Prisma.RelationUncheckedUpdateInput,
      });
      return toRelationRecord(updated);
    } catch (err) {
      if (isP2025(err)) return null;
      throw err;
    }
  },

  async remove(relation_id: string): Promise<boolean> {
    if (!/^\d+$/.test(relation_id)) {
      throw Object.assign(new Error('invalid relation_id'), { statusCode: 400 });
    }
    try {
      await prisma.relation.delete({
        where: { relation_id: BigInt(relation_id) },
      });
      return true;
    } catch (err) {
      if (isP2025(err)) return false;
      throw err;
    }
  },

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
    // Validate types first so a bad enum value is rejected before we hit PG.
    const valid = inputs.flatMap((r) => {
      const t = RelationType.parse(r.relation_type);
      if (t === 'BELONGS_TO_GRAPH') return [];
      return [{ ...r, relation_type: t }];
    });
    if (valid.length === 0) return 0;

    // Upsert via the (source_id, target_id, relation_type) unique constraint
    // — same idempotency the Cypher MERGE provided.
    const ops = valid.map((r) =>
      prisma.relation.upsert({
        where: {
          relations_unique_edge: {
            source_id: r.source_id,
            target_id: r.target_id,
            relation_type: r.relation_type,
          },
        },
        create: {
          graph_id: graphId,
          source_id: r.source_id,
          target_id: r.target_id,
          relation_type: r.relation_type,
          description: r.description ?? null,
          confidence: r.confidence ?? 1,
          status: opts.status ?? r.status ?? 'candidate',
          ai_job_id: opts.ai_job_id ?? r.ai_job_id ?? null,
        },
        update: {
          description: r.description ?? null,
          confidence: r.confidence ?? 1,
          status: opts.status ?? r.status ?? 'candidate',
          ai_job_id: opts.ai_job_id ?? r.ai_job_id ?? null,
        },
      }),
    );
    const written = await prisma.$transaction(ops);
    return written.length;
  },

  async bulkUpdateStatusByJob(
    graphId: string,
    aiJobId: string,
    status: z.infer<typeof NodeStatus>,
  ): Promise<number> {
    const res = await prisma.relation.updateMany({
      where: { graph_id: graphId, ai_job_id: aiJobId },
      data: { status },
    });
    return res.count;
  },

  async bulkDeleteByJob(graphId: string, aiJobId: string): Promise<number> {
    const res = await prisma.relation.deleteMany({
      where: {
        graph_id: graphId,
        ai_job_id: aiJobId,
        status: 'candidate',
      },
    });
    return res.count;
  },
};

// ---------------------------------------------------------------------------
// Public proxy
// ---------------------------------------------------------------------------

function impl() {
  return getStorageBackend() === 'pg' ? RelationServicePg : RelationServiceNeo4j;
}

export const RelationService = {
  create: (graph_id: string, input: z.infer<typeof RelationCreateInput>) =>
    impl().create(graph_id, input),
  listByGraph: (graph_id: string) => impl().listByGraph(graph_id),
  update: (relation_id: string, patch: RelationUpdateInput) =>
    impl().update(relation_id, patch),
  remove: (relation_id: string) => impl().remove(relation_id),
  createBatch: (
    graphId: string,
    inputs: Parameters<typeof RelationServicePg.createBatch>[1],
    opts: BatchRelationOptions = {},
  ) => impl().createBatch(graphId, inputs, opts),
  bulkUpdateStatusByJob: (
    graphId: string,
    aiJobId: string,
    status: z.infer<typeof NodeStatus>,
  ) => impl().bulkUpdateStatusByJob(graphId, aiJobId, status),
  bulkDeleteByJob: (graphId: string, aiJobId: string) =>
    impl().bulkDeleteByJob(graphId, aiJobId),
};
export type RelationService = typeof RelationService;
