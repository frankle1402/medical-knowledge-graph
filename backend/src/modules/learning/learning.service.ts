import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';

// ---------------------------------------------------------------------------
// Task 1: Learning path (recursive CTE over '前置' relations)
// ---------------------------------------------------------------------------

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
 * Walk backward from `node_id` along `relation_type='前置'` edges.
 *
 * Edge semantics: `A --前置--> B` means "A must be learned before B" (A is
 * a prerequisite of B). To produce a study order for B we walk from B
 * toward its sources (target_id = B → source_id = A), repeating up to
 * `q.depth` hops. Each hop reduces the `depth` field meaning "how far
 * from the target node the prereq sits". Output is sorted deepest-first
 * so callers can show foundational concepts at the top of a list.
 *
 * Implementation notes:
 * - `UNION` (not `UNION ALL`) on the CTE dedupes nodes encountered via
 *   multiple paths, which also stops cycles from looping forever.
 * - We only follow edges with `status='approved'`; pending / rejected
 *   edges are noise from the AI ingestion pipeline.
 * - `DISTINCT ON (node_id) ... ORDER BY node_id, depth ASC` keeps the
 *   shallowest depth per node when one prereq is reachable via multiple
 *   chains.
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

  const rows = await prisma.$queryRaw<Array<LearningPathStep>>`
    WITH RECURSIVE prereqs AS (
      SELECT n.node_id, n.name, 1 AS depth, r.relation_type AS via
      FROM relations r
      JOIN nodes n ON n.node_id = r.source_id
      WHERE r.target_id = ${node_id}
        AND r.relation_type = '前置'
        AND r.status = 'approved'

      UNION

      SELECT n.node_id, n.name, p.depth + 1 AS depth, r.relation_type AS via
      FROM prereqs p
      JOIN relations r ON r.target_id = p.node_id
      JOIN nodes n ON n.node_id = r.source_id
      WHERE r.relation_type = '前置'
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
 * For each target in `targets`, walk back along `relation_type='前置'` to
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
        AND r.relation_type = '前置'
        AND r.status = 'approved'

      UNION

      SELECT p.root, n.node_id, n.name, p.depth + 1
      FROM prereqs p
      JOIN relations r ON r.target_id = p.node_id
      JOIN nodes n ON n.node_id = r.source_id
      WHERE r.relation_type = '前置'
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

export const LearningService = {
  learningPath,
  knowledgeGap,
};
