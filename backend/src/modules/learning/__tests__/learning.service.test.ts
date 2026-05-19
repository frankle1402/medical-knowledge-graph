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

describe('LearningService.knowledgeGap', () => {
  beforeEach(async () => {
    // Two graphs of prereqs:
    //   A → B → C → D
    //   E → D
    //   F → C   (only relevant to target C)
    //   G → H is in a different graph (G2) — must be excluded
    await prisma.graph.create({
      data: { graph_id: 'G1', graph_name: 't', graph_type: 'curriculum' },
    });
    await prisma.graph.create({
      data: { graph_id: 'G2', graph_name: 't2', graph_type: 'curriculum' },
    });
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F']) {
      await prisma.node.create({
        data: {
          node_id: id,
          graph_id: 'G1',
          node_type: 'knowledge_point',
          name: id,
        },
      });
    }
    for (const id of ['G', 'H']) {
      await prisma.node.create({
        data: {
          node_id: id,
          graph_id: 'G2',
          node_type: 'knowledge_point',
          name: id,
        },
      });
    }
    const edges: Array<[string, string, string, string]> = [
      ['A', 'B', '前置', 'G1'],
      ['B', 'C', '前置', 'G1'],
      ['C', 'D', '前置', 'G1'],
      ['E', 'D', '前置', 'G1'],
      ['F', 'C', '前置', 'G1'],
      ['G', 'H', '前置', 'G2'],
    ];
    for (const [s, t, type, gid] of edges) {
      await prisma.relation.create({
        data: { graph_id: gid, source_id: s, target_id: t, relation_type: type },
      });
    }
  });

  it('returns all ancestors of target D when nothing is mastered', async () => {
    const { gaps } = await LearningService.knowledgeGap('G1', {
      mastered: [],
      targets: ['D'],
    });
    expect(gaps.map((g) => g.node_id)).toEqual(['A', 'B', 'C', 'E', 'F']);
    // Every gap blocks the requested target D
    for (const g of gaps) expect(g.blocking).toEqual(['D']);
  });

  it('removes mastered nodes from the gap set', async () => {
    const { gaps } = await LearningService.knowledgeGap('G1', {
      mastered: ['A', 'F'],
      targets: ['D'],
    });
    expect(gaps.map((g) => g.node_id)).toEqual(['B', 'C', 'E']);
  });

  it('aggregates blocking targets when one node blocks several', async () => {
    // C is required for D directly. C is itself the target → C should not
    // appear as a gap for itself, but B (prereq of C) blocks both C and D.
    const { gaps } = await LearningService.knowledgeGap('G1', {
      mastered: [],
      targets: ['C', 'D'],
    });
    const b = gaps.find((g) => g.node_id === 'B');
    expect(b?.blocking).toEqual(['C', 'D']);
    const a = gaps.find((g) => g.node_id === 'A');
    // A is a prereq of B which is a prereq of C and D, so A blocks both
    expect(a?.blocking).toEqual(['C', 'D']);
  });

  it('returns empty gaps when student has mastered everything required', async () => {
    const { gaps } = await LearningService.knowledgeGap('G1', {
      mastered: ['A', 'B', 'C', 'E', 'F'],
      targets: ['D'],
    });
    expect(gaps).toEqual([]);
  });

  it('does not leak relations from other graphs', async () => {
    // G2 has G → H. Asking for H in G2 should not see G1 nodes — and
    // asking for D in G1 should not see G/H.
    const r1 = await LearningService.knowledgeGap('G2', {
      mastered: [],
      targets: ['H'],
    });
    expect(r1.gaps.map((g) => g.node_id)).toEqual(['G']);

    const r2 = await LearningService.knowledgeGap('G1', {
      mastered: [],
      targets: ['D'],
    });
    expect(r2.gaps.find((g) => g.node_id === 'G')).toBeUndefined();
  });

  it('skips non-approved prereq edges', async () => {
    // Add I → D as 'pending'. Should not appear as a gap.
    await prisma.node.create({
      data: {
        node_id: 'I',
        graph_id: 'G1',
        node_type: 'knowledge_point',
        name: 'I',
      },
    });
    await prisma.relation.create({
      data: {
        graph_id: 'G1',
        source_id: 'I',
        target_id: 'D',
        relation_type: '前置',
        status: 'pending',
      },
    });
    const { gaps } = await LearningService.knowledgeGap('G1', {
      mastered: [],
      targets: ['D'],
    });
    expect(gaps.find((g) => g.node_id === 'I')).toBeUndefined();
  });
});
