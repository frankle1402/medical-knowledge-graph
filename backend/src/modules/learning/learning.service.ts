import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';

// ---------------------------------------------------------------------------
// Task 1: Learning path (recursive CTE over multiple relation types)
// ---------------------------------------------------------------------------

/**
 * Relation types the learning-path walker follows backward from the target.
 *
 * - `PREREQUISITE_OF`  classic "A must be learned before B" prerequisite chain.
 * - `HAS_STEP`         operation_process owns its operation_step children;
 *                      walking back from a step reaches its parent process.
 * - `NEXT_STEP`        adjacency between operation_steps; walking back assembles
 *                      the ordered sequence that leads up to the target step.
 *
 * NOTE: `knowledgeGap` retains PREREQUISITE_OF-only by design — the "what's still
 * blocking me" semantics for operation flows is not yet defined.
 */
const PATH_RELATION_TYPES = [
  'PREREQUISITE_OF',
  'HAS_STEP',
  'NEXT_STEP',
] as const;

export const LearningPathQuery = z.object({
  depth: z.coerce.number().int().min(1).max(10).default(5),
});
export type LearningPathQueryT = z.infer<typeof LearningPathQuery>;

export interface LearningPathStep {
  node_id: string;
  name: string;
  depth: number;
  via: string;
}

export interface LearningPath {
  target: { node_id: string; name: string };
  path: LearningPathStep[];
}

/**
 * Walk backward from `node_id` along the relation types listed in
 * `PATH_RELATION_TYPES` (PREREQUISITE_OF / HAS_STEP / NEXT_STEP).
 *
 * Edge semantics (all directed `source --type--> target`):
 * - `A --PREREQUISITE_OF--> B`: A must be learned before B.
 * - `P --HAS_STEP--> S`: operation_process P contains operation_step S.
 * - `S1 --NEXT_STEP--> S2`: step S1 immediately precedes step S2 in a process.
 *
 * To produce a study order for a target node we walk against each edge
 * (target_id → source_id), repeating up to `q.depth` hops. Each hop's
 * `depth` field encodes "how far from the target the predecessor sits".
 * Output is sorted deepest-first so callers can show foundational
 * concepts / earliest steps at the top of a list.
 *
 * Implementation notes:
 * - `UNION` (not `UNION ALL`) on the CTE dedupes nodes encountered via
 *   multiple paths, which also stops cycles from looping forever.
 * - We only follow edges with `status='approved'`; pending / rejected
 *   edges are noise from the AI ingestion pipeline.
 * - `DISTINCT ON (node_id) ... ORDER BY node_id, depth ASC` keeps the
 *   shallowest depth per node when one predecessor is reachable via
 *   multiple chains.
 */
async function learningPath(
  node_id: string,
  q: LearningPathQueryT,
): Promise<LearningPath | null> {
  const target = await prisma.node.findUnique({
    where: { node_id },
    select: { node_id: true, name: true },
  });
  if (!target) return null;

  const types = Prisma.sql`(${Prisma.join(
    PATH_RELATION_TYPES.map((t) => Prisma.sql`${t}`),
  )})`;

  const rows = await prisma.$queryRaw<Array<LearningPathStep>>`
    WITH RECURSIVE prereqs AS (
      SELECT n.node_id, n.name, 1 AS depth, r.relation_type AS via
      FROM relations r
      JOIN nodes n ON n.node_id = r.source_id
      WHERE r.target_id = ${node_id}
        AND r.relation_type IN ${types}
        AND r.status = 'approved'

      UNION

      SELECT n.node_id, n.name, p.depth + 1 AS depth, r.relation_type AS via
      FROM prereqs p
      JOIN relations r ON r.target_id = p.node_id
      JOIN nodes n ON n.node_id = r.source_id
      WHERE r.relation_type IN ${types}
        AND r.status = 'approved'
        AND p.depth < ${q.depth}::int
    )
    SELECT DISTINCT ON (node_id) node_id, name, depth, via
    FROM prereqs
    ORDER BY node_id, depth ASC
  `;

  // Foundational first: largest depth on top, depth 1 (direct prereq) at bottom.
  rows.sort((a, b) => b.depth - a.depth);

  return { target, path: rows };
}

// ---------------------------------------------------------------------------
// Task 2: Knowledge gap
// ---------------------------------------------------------------------------

export const KnowledgeGapInput = z.object({
  mastered: z.array(z.string()).default([]),
  targets: z.array(z.string()).min(1),
});
export type KnowledgeGapInputT = z.infer<typeof KnowledgeGapInput>;

export interface KnowledgeGap {
  node_id: string;
  name: string;
  blocking: string[];
}
export interface KnowledgeGapResult {
  gaps: KnowledgeGap[];
}

/**
 * For each target in `targets`, walk back along `relation_type='PREREQUISITE_OF'` to
 * collect every ancestor (transitively required prereq). Subtract the
 * `mastered` set. The remaining nodes are the student's knowledge gaps;
 * each is annotated with `blocking` = the targets they unblock.
 *
 * Notes:
 * - We scope the walk to the requested graph via `r.graph_id` because
 *   node_id is globally unique but it is still cheap to constrain and
 *   guards against cross-graph relations leaking through if any are
 *   added later.
 * - `UNION` dedupes inside the recursion, so cycles terminate.
 * - Depth cap is hardcoded at 10 hops to mirror the LearningPath max
 *   and to keep the worst case bounded for arbitrary input.
 * - When `mastered` is empty we still need a NOT-IN check that matches
 *   nothing; we pass a sentinel `'__never__'` value because PG arrays
 *   cannot be empty when typed as `text[]` in this position.
 */
async function knowledgeGap(
  graph_id: string,
  input: KnowledgeGapInputT,
): Promise<KnowledgeGapResult> {
  const masteredArr = input.mastered.length > 0 ? input.mastered : ['__never__'];

  const rows = await prisma.$queryRaw<
    Array<{ node_id: string; name: string; target_id: string }>
  >`
    WITH RECURSIVE prereqs AS (
      SELECT r.target_id AS root, n.node_id, n.name, 1 AS depth
      FROM relations r
      JOIN nodes n ON n.node_id = r.source_id
      WHERE r.target_id = ANY(${input.targets}::text[])
        AND r.graph_id = ${graph_id}
        AND r.relation_type = 'PREREQUISITE_OF'
        AND r.status = 'approved'

      UNION

      SELECT p.root, n.node_id, n.name, p.depth + 1
      FROM prereqs p
      JOIN relations r ON r.target_id = p.node_id
      JOIN nodes n ON n.node_id = r.source_id
      WHERE r.relation_type = 'PREREQUISITE_OF'
        AND r.status = 'approved'
        AND r.graph_id = ${graph_id}
        AND p.depth < 10
    )
    SELECT DISTINCT node_id, name, root AS target_id
    FROM prereqs
    WHERE node_id <> ALL(${masteredArr}::text[])
  `;

  // Aggregate per node_id → blocking set.
  const map = new Map<
    string,
    { node_id: string; name: string; blocking: Set<string> }
  >();
  for (const r of rows) {
    const e =
      map.get(r.node_id) ??
      { node_id: r.node_id, name: r.name, blocking: new Set<string>() };
    e.blocking.add(r.target_id);
    map.set(r.node_id, e);
  }

  return {
    gaps: [...map.values()]
      .map((e) => ({
        node_id: e.node_id,
        name: e.name,
        blocking: [...e.blocking].sort(),
      }))
      .sort((a, b) => a.node_id.localeCompare(b.node_id)),
  };
}

// ---------------------------------------------------------------------------
// Task 3: Synonym candidates (pgvector cosine)
// ---------------------------------------------------------------------------

export const SynonymQuery = z.object({
  threshold: z.coerce.number().min(0.85).max(0.99).default(0.92),
});
export type SynonymQueryT = z.infer<typeof SynonymQuery>;

export interface SynonymCandidate {
  a: { node_id: string; name: string };
  b: { node_id: string; name: string };
  score: number;
}

/**
 * Signaled by the route layer with HTTP 503 — the API is still wired up
 * but cannot answer until Pack C's embedding backfill has populated the
 * `embedding` column for at least one pair of nodes in this graph.
 */
export class EmbeddingsNotReadyError extends Error {
  status = 503;
  code = 'embeddings_not_ready';
  constructor(public graph_id: string) {
    super(`embeddings not yet populated for graph ${graph_id}`);
  }
}

/**
 * Find pairs of nodes within the same graph whose embedding cosine
 * similarity meets or exceeds `threshold`. Pairs are deduped via the
 * canonical ordering `n1.node_id < n2.node_id` (string comparison) so
 * (a, b) and (b, a) collapse into one row. Capped at 50 results, sorted
 * by ascending distance (closest pairs first).
 *
 * pgvector's `<=>` operator returns cosine *distance* in [0, 2]. For
 * unit-normalized embeddings — which is the convention for OpenAI /
 * BGE-style models Pack C wires up — distance equals 1 - cosine
 * similarity, so `dist <= 1 - threshold` selects pairs at or above
 * the threshold and `score = 1 - dist` recovers the similarity.
 *
 * If no node in the graph has an embedding the API responds 503 to
 * tell the caller "rerun the backfill" rather than silently empty.
 */
async function synonymCandidates(
  graph_id: string,
  q: SynonymQueryT,
): Promise<SynonymCandidate[]> {
  // Guard: if the graph has zero embedded nodes, treat as not ready.
  // We don't require ALL nodes to be embedded (partial coverage is
  // useful) — just that at least one pair could be evaluated.
  const counts = await prisma.$queryRaw<Array<{ embedded: bigint }>>`
    SELECT COUNT(*)::bigint AS embedded
    FROM nodes
    WHERE graph_id = ${graph_id} AND embedding IS NOT NULL
  `;
  if (Number(counts[0]?.embedded ?? 0) < 2) {
    throw new EmbeddingsNotReadyError(graph_id);
  }

  const cosineDistanceCap = 1 - q.threshold;

  const rows = await prisma.$queryRaw<
    Array<{
      a_id: string;
      a_name: string;
      b_id: string;
      b_name: string;
      dist: number;
    }>
  >`
    SELECT
      n1.node_id AS a_id, n1.name AS a_name,
      n2.node_id AS b_id, n2.name AS b_name,
      (n1.embedding <=> n2.embedding) AS dist
    FROM nodes n1
    JOIN nodes n2 ON n1.graph_id = n2.graph_id
                  AND n1.node_id < n2.node_id
    WHERE n1.graph_id = ${graph_id}
      AND n1.embedding IS NOT NULL
      AND n2.embedding IS NOT NULL
      AND (n1.embedding <=> n2.embedding) <= ${cosineDistanceCap}
    ORDER BY dist ASC
    LIMIT 50
  `;

  return rows.map((r) => ({
    a: { node_id: r.a_id, name: r.a_name },
    b: { node_id: r.b_id, name: r.b_name },
    score: Number((1 - r.dist).toFixed(4)),
  }));
}

export const LearningService = {
  learningPath,
  knowledgeGap,
  synonymCandidates,
};
