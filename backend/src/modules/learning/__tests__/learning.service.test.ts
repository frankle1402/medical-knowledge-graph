import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma';
import { LearningService } from '../learning.service';

/**
 * These tests assume STORAGE_BACKEND=pg (the vitest default). The
 * `setup.ts` hook truncates `relations`, `nodes`, `graphs` between cases
 * so we can rebuild the fixture deterministically.
 */
async function seedChain(): Promise<void> {
  await prisma.graph.create({
    data: { graph_id: 'G1', graph_name: 'test', graph_type: 'curriculum' },
  });
  // Build chain: A → B → C → D ('前置' edges)
  for (const id of ['A', 'B', 'C', 'D']) {
    await prisma.node.create({
      data: {
        node_id: id,
        graph_id: 'G1',
        node_type: 'knowledge_point',
        name: id,
      },
    });
  }
  for (const [s, t] of [
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'D'],
  ]) {
    await prisma.relation.create({
      data: {
        graph_id: 'G1',
        source_id: s as string,
        target_id: t as string,
        relation_type: '前置',
      },
    });
  }
}

describe('LearningService.learningPath', () => {
  beforeEach(async () => {
    await seedChain();
  });

  it('returns full chain for D up to depth 5, deepest first', async () => {
    const r = await LearningService.learningPath('D', { depth: 5 });
    expect(r?.target.node_id).toBe('D');
    expect(r?.path.map((s) => s.node_id)).toEqual(['A', 'B', 'C']);
    // A is deepest (depth 3), C is closest (depth 1)
    expect(r?.path[0]?.depth).toBe(3);
    expect(r?.path[2]?.depth).toBe(1);
    expect(r?.path[0]?.via).toBe('前置');
  });

  it('respects depth limit', async () => {
    const r = await LearningService.learningPath('D', { depth: 1 });
    expect(r?.path.map((s) => s.node_id)).toEqual(['C']);
  });

  it('returns null for unknown node', async () => {
    expect(await LearningService.learningPath('NOPE', { depth: 5 })).toBeNull();
  });

  it('returns empty path when target has no prereqs', async () => {
    const r = await LearningService.learningPath('A', { depth: 5 });
    expect(r?.target.node_id).toBe('A');
    expect(r?.path).toEqual([]);
  });

  it('ignores non-approved prerequisite edges', async () => {
    // Add E → D as 'pending' — should not appear.
    await prisma.node.create({
      data: {
        node_id: 'E',
        graph_id: 'G1',
        node_type: 'knowledge_point',
        name: 'E',
      },
    });
    await prisma.relation.create({
      data: {
        graph_id: 'G1',
        source_id: 'E',
        target_id: 'D',
        relation_type: '前置',
        status: 'pending',
      },
    });
    const r = await LearningService.learningPath('D', { depth: 5 });
    expect(r?.path.map((s) => s.node_id)).toEqual(['A', 'B', 'C']);
  });

  it('ignores edges of other relation_type', async () => {
    await prisma.node.create({
      data: {
        node_id: 'X',
        graph_id: 'G1',
        node_type: 'knowledge_point',
        name: 'X',
      },
    });
    await prisma.relation.create({
      data: {
        graph_id: 'G1',
        source_id: 'X',
        target_id: 'D',
        relation_type: '相关',
      },
    });
    const r = await LearningService.learningPath('D', { depth: 5 });
    expect(r?.path.map((s) => s.node_id)).toEqual(['A', 'B', 'C']);
  });

  it('does not loop forever on a cycle', async () => {
    // Insert D → A to create a cycle. UNION dedup keeps the recursion finite.
    await prisma.relation.create({
      data: {
        graph_id: 'G1',
        source_id: 'D',
        target_id: 'A',
        relation_type: '前置',
      },
    });
    const r = await LearningService.learningPath('D', { depth: 10 });
    // Each node appears once
    const ids = (r?.path ?? []).map((s) => s.node_id).sort();
    expect(ids).toEqual(['A', 'B', 'C', 'D']);
  });
});
