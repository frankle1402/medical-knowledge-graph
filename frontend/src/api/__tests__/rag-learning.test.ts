import { describe, expect, it, vi, afterEach } from 'vitest';
import { learningApi, searchApi } from '../index';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('searchApi.semantic', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to /api/graphs/:id/search with q/k/include_neighbors body', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ matches: [] }));

    await searchApi.semantic('g1', '心力衰竭', 5, true);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/graphs/g1/search');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      q: '心力衰竭',
      k: 5,
      include_neighbors: true,
    });
  });

  it('returns the matches payload as-is', async () => {
    const payload = {
      matches: [
        {
          node: { node_id: 'n1', name: '心律失常', node_type: 'knowledge_point' },
          score: 0.91,
          neighbors: [],
        },
      ],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(payload));
    const res = await searchApi.semantic('g1', '心跳');
    expect(res.matches[0]?.node.name).toBe('心律失常');
    expect(res.matches[0]?.score).toBeCloseTo(0.91);
  });

  it('uses default k=10 and include_neighbors=true', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ matches: [] }));

    await searchApi.semantic('g1', 'q');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      q: 'q',
      k: 10,
      include_neighbors: true,
    });
  });

  it('propagates 503 as an ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'embedding_service_unavailable' }, 503, { 'retry-after': '5' }),
    );
    await expect(searchApi.semantic('g1', 'q')).rejects.toMatchObject({ status: 503 });
  });

  it('encodes graph_id path segment', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ matches: [] }));
    await searchApi.semantic('graph/with slash', 'q');
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('graph%2Fwith%20slash');
  });
});

describe('learningApi.learningPath', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GETs /api/nodes/:id/learning-path with depth query', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ target: { node_id: 'n1', name: 'X' }, path: [] }));

    await learningApi.learningPath('n1', 3);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/nodes/n1/learning-path');
    expect(String(url)).toContain('depth=3');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('uses default depth=5', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ target: { node_id: 'n', name: 'n' }, path: [] }));
    await learningApi.learningPath('n');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('depth=5');
  });

  it('propagates 404 as ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'node_not_found' }, 404),
    );
    await expect(learningApi.learningPath('missing')).rejects.toMatchObject({ status: 404 });
  });
});

describe('learningApi.knowledgeGap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs body { mastered, targets }', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ gaps: [] }));
    await learningApi.knowledgeGap('g1', ['m1'], ['t1', 't2']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/graphs/g1/knowledge-gap');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      mastered: ['m1'],
      targets: ['t1', 't2'],
    });
  });
});

describe('learningApi.synonymCandidates', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GETs with threshold query', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ candidates: [] }));
    await learningApi.synonymCandidates('g1', 0.95);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/api/graphs/g1/synonym-candidates');
    expect(url).toContain('threshold=0.95');
  });

  it('uses default threshold=0.92', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ candidates: [] }));
    await learningApi.synonymCandidates('g1');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('threshold=0.92');
  });

  it('propagates 503 embeddings_not_ready as ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'embeddings_not_ready' }, 503),
    );
    await expect(learningApi.synonymCandidates('g1')).rejects.toMatchObject({ status: 503 });
  });
});
