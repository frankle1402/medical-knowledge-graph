/**
 * Semantic search service.
 *
 * Flow
 * ----
 * 1. Embed the user query via OpenAI.
 * 2. Order nodes within `graph_id` by cosine distance (`<=>`) against the
 *    pgvector column. Smaller distance = closer match.
 * 3. Optionally enrich each match with its 1-hop neighbors (in or out edges).
 *
 * Exposing `score` as `1 - distance` keeps the contract intuitive for the
 * frontend: bigger is better, range ~ -1..1 (in practice 0..1 for normalized
 * embeddings — pgvector's `<=>` is bounded in [0, 2]).
 *
 * Nodes without an embedding are filtered out at the SQL level. The frontend
 * gets an honest "no match" rather than a noisy stub if the backfill hasn't
 * run yet.
 */
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { embed } from '../../services/embedding/openai.js';

export const SearchInput = z.object({
  q: z.string().min(1).max(500),
  k: z.coerce.number().int().min(1).max(50).default(10),
  include_neighbors: z.coerce.boolean().default(true),
});
export type SearchInputT = z.infer<typeof SearchInput>;

export interface SearchNode extends Record<string, unknown> {
  node_id: string;
  graph_id: string;
  node_type: string;
  name: string;
}

export interface SearchMatch {
  node: SearchNode;
  score: number;
  neighbors?: SearchNode[];
}

export interface SearchResult {
  matches: SearchMatch[];
}

interface RawNodeRow {
  node_id: string;
  graph_id: string;
  node_type: string;
  knowledge_type: string | null;
  name: string;
  description: string | null;
  status: string;
  source: string;
  confidence: number;
  tags: unknown;
  ai_job_id: string | null;
  created_at: Date;
  updated_at: Date;
  distance: number | string;
}

function toPlainNode(r: Record<string, unknown>): SearchNode {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'distance' || k === 'embedding') continue;
    if (v === null || v === undefined) continue;
    if (v instanceof Date) {
      out[k] = v.toISOString();
    } else {
      out[k] = v;
    }
  }
  return out as SearchNode;
}

/**
 * Format a JS number array as a pgvector literal.
 * Example: [0.1, 0.2] -> "[0.1,0.2]". The `::vector` cast is added in SQL.
 */
function vectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

export const SearchService = {
  async search(graph_id: string, input: SearchInputT): Promise<SearchResult> {
    const queryVec = await embed(input.q);
    const lit = vectorLiteral(queryVec);

    // Cosine distance: pgvector's `<=>` returns 0..2 where 0 is identical.
    // ORDER BY ASC -> smallest distance first.
    //
    // We bind the literal as a Prisma parameter and do the cast in SQL. The
    // parameter goes through libpq; SQL injection isn't a concern here because
    // the literal only contains numbers + commas + brackets, but we still
    // never concat it into the query text.
    const rows = await prisma.$queryRaw<RawNodeRow[]>(Prisma.sql`
      SELECT node_id, graph_id, node_type, knowledge_type, name, description,
             status, source, confidence, tags, ai_job_id,
             created_at, updated_at,
             (embedding <=> ${lit}::vector) AS distance
      FROM nodes
      WHERE graph_id = ${graph_id}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${lit}::vector
      LIMIT ${input.k}
    `);

    const matches: SearchMatch[] = rows.map((r) => ({
      node: toPlainNode(r as unknown as Record<string, unknown>),
      score: 1 - Number(r.distance),
    }));

    if (!input.include_neighbors || matches.length === 0) {
      return { matches };
    }

    // 1-hop neighbor enrichment. Single relation query covering both
    // directions, then a single node query for the union of neighbor ids.
    const matchIds = matches.map((m) => m.node.node_id);
    const rels = await prisma.relation.findMany({
      where: {
        OR: [
          { source_id: { in: matchIds } },
          { target_id: { in: matchIds } },
        ],
      },
      select: { source_id: true, target_id: true },
    });

    const neighborIds = new Set<string>();
    for (const r of rels) {
      if (matchIds.includes(r.source_id)) neighborIds.add(r.target_id);
      if (matchIds.includes(r.target_id)) neighborIds.add(r.source_id);
    }
    // Don't include self-matches as their own neighbors.
    for (const id of matchIds) neighborIds.delete(id);

    const neighborNodes = neighborIds.size === 0
      ? []
      : await prisma.node.findMany({
          where: { node_id: { in: [...neighborIds] } },
        });
    const neighborById = new Map<string, SearchNode>();
    for (const n of neighborNodes) {
      neighborById.set(
        n.node_id,
        toPlainNode(n as unknown as Record<string, unknown>),
      );
    }

    const neighborsByMatch: Record<string, SearchNode[]> = {};
    for (const id of matchIds) neighborsByMatch[id] = [];
    for (const r of rels) {
      const sourceMatch = matchIds.includes(r.source_id);
      const targetMatch = matchIds.includes(r.target_id);
      if (sourceMatch && r.target_id !== r.source_id) {
        const n = neighborById.get(r.target_id);
        if (n && !neighborsByMatch[r.source_id]!.some((x) => x.node_id === n.node_id)) {
          neighborsByMatch[r.source_id]!.push(n);
        }
      }
      if (targetMatch && r.source_id !== r.target_id) {
        const n = neighborById.get(r.source_id);
        if (n && !neighborsByMatch[r.target_id]!.some((x) => x.node_id === n.node_id)) {
          neighborsByMatch[r.target_id]!.push(n);
        }
      }
    }
    for (const m of matches) {
      m.neighbors = neighborsByMatch[m.node.node_id] ?? [];
    }
    return { matches };
  },
};
