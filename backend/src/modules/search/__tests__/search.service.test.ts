/**
 * SearchService tests.
 *
 * Strategy: seed nodes with hand-crafted unit-vectors so cosine distance is
 * predictable. The mocked `embed()` returns the query vector as another
 * unit vector chosen so we know which seeded node should rank first.
 *
 * Vectors live in 1536-dim space, but only the first two slots carry signal —
 * the rest are zero. Since pgvector's `<=>` is plain cosine distance, the
 * extra zeros don't change the ordering, they just match the column type.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GraphService } from '../../graphs/graph.service';
import { NodeService } from '../../nodes/node.service';
import { RelationService } from '../../relations/relation.service';
import { prisma } from '../../../lib/prisma';
import { SearchService, SearchInput } from '../search.service';
import { EMBEDDING_DIM } from '../../../services/embedding/openai';

const createMock = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: (...args: unknown[]) => createMock(...args),
    },
  })),
}));

function unitVec(x: number, y: number): number[] {
  const v = new Array(EMBEDDING_DIM).fill(0);
  const m = Math.sqrt(x * x + y * y) || 1;
  v[0] = x / m;
  v[1] = y / m;
  return v;
}

async function setEmbedding(node_id: string, vec: number[]): Promise<void> {
  const lit = `[${vec.join(',')}]`;
  await prisma.$executeRaw`UPDATE nodes SET embedding = ${lit}::vector WHERE node_id = ${node_id}`;
}

describe('SearchInput', () => {
  it('rejects empty q', () => {
    expect(() => SearchInput.parse({ q: '' })).toThrow();
  });
  it('rejects k > 50', () => {
    expect(() => SearchInput.parse({ q: 'x', k: 51 })).toThrow();
  });
  it('rejects k < 1', () => {
    expect(() => SearchInput.parse({ q: 'x', k: 0 })).toThrow();
  });
  it('defaults k=10 and include_neighbors=true', () => {
    const p = SearchInput.parse({ q: 'x' });
    expect(p.k).toBe(10);
    expect(p.include_neighbors).toBe(true);
  });
  it('rejects q over 500 chars', () => {
    expect(() => SearchInput.parse({ q: 'a'.repeat(501) })).toThrow();
  });
});

describe('SearchService', () => {
  let graphId: string;
  let kpA: string;
  let kpB: string;
  let kpC: string;
  let neighborOfA: string;

  beforeEach(async () => {
    createMock.mockReset();
    const g = await GraphService.create({
      graph_name: 'search-test',
      graph_type: 'course',
      created_by: 'tester',
    });
    graphId = g.graph_id;

    // Three target nodes with different orientations:
    //   A -> (1, 0)        // closest to query (1, 0.05)
    //   B -> (0.7, 0.7)
    //   C -> (0, 1)        // furthest
    const A = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'A-node',
      knowledge_type: '概念类',
    } as never);
    const B = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'B-node',
      knowledge_type: '概念类',
    } as never);
    const C = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'C-node',
      knowledge_type: '概念类',
    } as never);
    kpA = A!.node_id as string;
    kpB = B!.node_id as string;
    kpC = C!.node_id as string;

    // One neighbor of A (won't be in the matches itself unless k is large
    // enough — but at k=3 the three above already fill all slots).
    const N = await NodeService.create(graphId, {
      node_type: 'knowledge_point',
      name: 'A-neighbor',
      knowledge_type: '概念类',
    } as never);
    neighborOfA = N!.node_id as string;
    // Give the neighbor a far-away embedding so it never wins by accident.
    await setEmbedding(neighborOfA, unitVec(-1, 0));

    await setEmbedding(kpA, unitVec(1, 0));
    await setEmbedding(kpB, unitVec(0.7, 0.7));
    await setEmbedding(kpC, unitVec(0, 1));

    await RelationService.create(graphId, {
      source_id: kpA,
      target_id: neighborOfA,
      relation_type: 'RELATED_TO',
    } as never);
  });

  afterEach(() => {
    createMock.mockReset();
  });

  function mockQueryVec(x: number, y: number): void {
    createMock.mockResolvedValue({ data: [{ embedding: unitVec(x, y) }] });
  }

  it('orders matches by cosine distance ascending', async () => {
    mockQueryVec(1, 0.05);
    const r = await SearchService.search(graphId, {
      q: 'pretend-this-is-A',
      k: 3,
      include_neighbors: false,
    });
    const ids = r.matches.map((m) => m.node.node_id);
    expect(ids[0]).toBe(kpA);
    expect(ids[1]).toBe(kpB);
    expect(ids[2]).toBe(kpC);
  });

  it('exposes score as 1 - cosine_distance with the closest node scoring highest', async () => {
    mockQueryVec(1, 0);
    const r = await SearchService.search(graphId, {
      q: 'exact-A',
      k: 3,
      include_neighbors: false,
    });
    expect(r.matches[0]!.node.node_id).toBe(kpA);
    expect(r.matches[0]!.score).toBeCloseTo(1, 5);
    expect(r.matches[2]!.score).toBeCloseTo(0, 5);
    // Monotonic descending.
    expect(r.matches[0]!.score).toBeGreaterThan(r.matches[1]!.score);
    expect(r.matches[1]!.score).toBeGreaterThan(r.matches[2]!.score);
  });

  it('respects k', async () => {
    mockQueryVec(1, 0);
    const r = await SearchService.search(graphId, {
      q: 'exact-A',
      k: 1,
      include_neighbors: false,
    });
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.node.node_id).toBe(kpA);
  });

  it('filters out nodes without an embedding', async () => {
    // Wipe A's embedding — it should disappear from results.
    await prisma.$executeRaw`UPDATE nodes SET embedding = NULL WHERE node_id = ${kpA}`;
    mockQueryVec(1, 0);
    const r = await SearchService.search(graphId, {
      q: 'exact-A',
      k: 5,
      include_neighbors: false,
    });
    const ids = r.matches.map((m) => m.node.node_id);
    expect(ids).not.toContain(kpA);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('scopes results to the requested graph_id', async () => {
    const otherG = await GraphService.create({
      graph_name: 'other',
      graph_type: 'course',
      created_by: 'tester',
    });
    const X = await NodeService.create(otherG.graph_id, {
      node_type: 'knowledge_point',
      name: 'OtherGraphNode',
      knowledge_type: '概念类',
    } as never);
    await setEmbedding(X!.node_id as string, unitVec(1, 0));

    mockQueryVec(1, 0);
    const r = await SearchService.search(graphId, {
      q: 'exact-A',
      k: 5,
      include_neighbors: false,
    });
    const ids = r.matches.map((m) => m.node.node_id);
    expect(ids).not.toContain(X!.node_id);
  });

  it('attaches 1-hop neighbors when include_neighbors=true', async () => {
    mockQueryVec(1, 0);
    const r = await SearchService.search(graphId, {
      q: 'exact-A',
      k: 3,
      include_neighbors: true,
    });
    const a = r.matches.find((m) => m.node.node_id === kpA);
    expect(a).toBeTruthy();
    expect(a!.neighbors).toBeDefined();
    expect(a!.neighbors!.map((n) => n.node_id)).toContain(neighborOfA);
  });

  it('omits neighbors when include_neighbors=false', async () => {
    mockQueryVec(1, 0);
    const r = await SearchService.search(graphId, {
      q: 'exact-A',
      k: 3,
      include_neighbors: false,
    });
    for (const m of r.matches) {
      expect(m.neighbors).toBeUndefined();
    }
  });

  it('returns empty matches when no node has an embedding', async () => {
    await prisma.$executeRawUnsafe(`UPDATE nodes SET embedding = NULL WHERE graph_id = '${graphId}'`);
    mockQueryVec(1, 0);
    const r = await SearchService.search(graphId, {
      q: 'anything',
      k: 5,
      include_neighbors: true,
    });
    expect(r.matches).toEqual([]);
  });

  it('serializes Date columns to ISO strings on returned nodes', async () => {
    mockQueryVec(1, 0);
    const r = await SearchService.search(graphId, {
      q: 'exact-A',
      k: 1,
      include_neighbors: false,
    });
    const node = r.matches[0]!.node;
    expect(typeof node.created_at).toBe('string');
    expect(node.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('does not include the binary embedding column in the response', async () => {
    mockQueryVec(1, 0);
    const r = await SearchService.search(graphId, {
      q: 'exact-A',
      k: 1,
      include_neighbors: false,
    });
    expect((r.matches[0]!.node as Record<string, unknown>).embedding).toBeUndefined();
  });
});
