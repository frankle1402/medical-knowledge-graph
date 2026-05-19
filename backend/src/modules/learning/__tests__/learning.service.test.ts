import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma';
import { LearningService, EmbeddingsNotReadyError } from '../learning.service';

/**
 * These tests assume STORAGE_BACKEND=pg (the vitest default). The
 * `setup.ts` hook truncates `relations`, `nodes`, `graphs` between cases
 * so we can rebuild the fixture deterministically.
 */
async function seedChain(): Promise<void> {
  await prisma.graph.create({
    data: { graph_id: 'G1', graph_name: 'test', graph_type: 'curriculum' },
  });
  // Build chain: A → B → C → D ('PREREQUISITE_OF' edges)
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
        relation_type: 'PREREQUISITE_OF',
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
    expect(r?.path[0]?.via).toBe('PREREQUISITE_OF');
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
        relation_type: 'PREREQUISITE_OF',
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
        relation_type: 'PREREQUISITE_OF',
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
      ['A', 'B', 'PREREQUISITE_OF', 'G1'],
      ['B', 'C', 'PREREQUISITE_OF', 'G1'],
      ['C', 'D', 'PREREQUISITE_OF', 'G1'],
      ['E', 'D', 'PREREQUISITE_OF', 'G1'],
      ['F', 'C', 'PREREQUISITE_OF', 'G1'],
      ['G', 'H', 'PREREQUISITE_OF', 'G2'],
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
        relation_type: 'PREREQUISITE_OF',
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

// ---------------------------------------------------------------------------
// Synonym candidates
// ---------------------------------------------------------------------------

/**
 * Build a 1536-dim vector literal in pgvector's text format. Values are
 * filled into the first `presetValues.length` slots; the remainder is
 * zero-padded so the vector matches the schema's `vector(1536)` type.
 */
function vectorLiteral(presetValues: number[]): string {
  const dim = 1536;
  const arr = new Array(dim).fill(0);
  for (let i = 0; i < presetValues.length && i < dim; i++) {
    arr[i] = presetValues[i];
  }
  // Normalize so cosine distance behaves like 1 - cosine similarity.
  const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  if (norm > 0) for (let i = 0; i < dim; i++) arr[i] = arr[i] / norm;
  return `[${arr.join(',')}]`;
}

async function setEmbedding(node_id: string, vec: number[]): Promise<void> {
  const lit = vectorLiteral(vec);
  await prisma.$executeRawUnsafe(
    `UPDATE nodes SET embedding = $1::vector WHERE node_id = $2`,
    lit,
    node_id,
  );
}

describe('LearningService.synonymCandidates', () => {
  beforeEach(async () => {
    await prisma.graph.create({
      data: { graph_id: 'G1', graph_name: 't', graph_type: 'curriculum' },
    });
    await prisma.graph.create({
      data: { graph_id: 'G2', graph_name: 't2', graph_type: 'curriculum' },
    });
    for (const id of ['N1', 'N2', 'N3', 'N4']) {
      await prisma.node.create({
        data: {
          node_id: id,
          graph_id: 'G1',
          node_type: 'knowledge_point',
          name: `name-${id}`,
        },
      });
    }
    await prisma.node.create({
      data: {
        node_id: 'X1',
        graph_id: 'G2',
        node_type: 'knowledge_point',
        name: 'name-X1',
      },
    });
    await prisma.node.create({
      data: {
        node_id: 'X2',
        graph_id: 'G2',
        node_type: 'knowledge_point',
        name: 'name-X2',
      },
    });
  });

  it('throws EmbeddingsNotReadyError when no node is embedded', async () => {
    await expect(
      LearningService.synonymCandidates('G1', { threshold: 0.92 }),
    ).rejects.toBeInstanceOf(EmbeddingsNotReadyError);
  });

  it('returns pairs above threshold, ordered by similarity DESC', async () => {
    // N1, N2 are nearly identical (high cosine similarity).
    // N3 is also similar to N1 but less so.
    // N4 is orthogonal — should be filtered out.
    await setEmbedding('N1', [1, 0.01, 0]);
    await setEmbedding('N2', [1, 0.02, 0]);
    await setEmbedding('N3', [1, 0.4, 0]);
    await setEmbedding('N4', [0, 0, 1]);

    const out = await LearningService.synonymCandidates('G1', { threshold: 0.92 });
    // N1/N2 must appear; N4 must not appear paired with N1.
    const pairKeys = out.map((p) => `${p.a.node_id}-${p.b.node_id}`).sort();
    expect(pairKeys).toContain('N1-N2');
    expect(pairKeys.find((k) => k.includes('N4'))).toBeUndefined();
    // Closest pair first — N1/N2 should be at index 0
    expect(out[0]?.a.node_id).toBe('N1');
    expect(out[0]?.b.node_id).toBe('N2');
    expect(out[0]?.score).toBeGreaterThan(0.92);
  });

  it('respects threshold: stricter threshold drops borderline pairs', async () => {
    await setEmbedding('N1', [1, 0.01, 0]);
    await setEmbedding('N2', [1, 0.02, 0]);
    await setEmbedding('N3', [1, 0.4, 0]);
    await setEmbedding('N4', [0, 0, 1]);

    const lax = await LearningService.synonymCandidates('G1', { threshold: 0.85 });
    const strict = await LearningService.synonymCandidates('G1', { threshold: 0.99 });
    expect(lax.length).toBeGreaterThanOrEqual(strict.length);
    // Strict 0.99 should still keep N1/N2 (they're effectively identical) but
    // drop N1/N3 etc.
    expect(strict.every((p) => p.score >= 0.99)).toBe(true);
  });

  it('does not return pairs across graphs', async () => {
    await setEmbedding('N1', [1, 0, 0]);
    await setEmbedding('N2', [1, 0.005, 0]);
    await setEmbedding('X1', [1, 0.005, 0]);
    await setEmbedding('X2', [1, 0.01, 0]);

    const g1 = await LearningService.synonymCandidates('G1', { threshold: 0.9 });
    expect(
      g1.every(
        (p) =>
          p.a.node_id.startsWith('N') && p.b.node_id.startsWith('N'),
      ),
    ).toBe(true);
  });

  it('dedupes (a,b) and (b,a) into a single canonically-ordered pair', async () => {
    await setEmbedding('N1', [1, 0, 0]);
    await setEmbedding('N2', [1, 0.005, 0]);

    const out = await LearningService.synonymCandidates('G1', { threshold: 0.9 });
    const pairs = out.map((p) => `${p.a.node_id}-${p.b.node_id}`);
    expect(pairs).toEqual(['N1-N2']);
    // No reverse pair
    expect(pairs).not.toContain('N2-N1');
  });
});
