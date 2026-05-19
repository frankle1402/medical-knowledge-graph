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

export const LearningService = {
  learningPath,
};
