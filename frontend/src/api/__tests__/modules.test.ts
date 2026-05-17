import { describe, expect, it, vi, afterEach } from 'vitest';
import { aiApi, graphsApi, nodesApi, relationsApi, templatesApi, usersApi } from '../index';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('api modules', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('graphsApi.list calls GET /api/graphs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    await graphsApi.list();
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/graphs');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('GET');
  });

  it('graphsApi.create posts payload', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ graph_id: 'g1' }));
    await graphsApi.create({ graph_name: 'x', graph_type: 'course' });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
  });

  it('nodesApi.list builds query string', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ items: [] }));
    await nodesApi.list('g1', { keyword: 'foo', limit: 5 });
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/graphs/g1/nodes');
    expect(url).toContain('keyword=foo');
    expect(url).toContain('limit=5');
  });

  it('nodesApi.create / update / remove hit the right paths and methods', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ node_id: 'n1' }))
      .mockResolvedValueOnce(jsonResponse({ node_id: 'n1' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await nodesApi.create('g1', { node_type: 'knowledge_point', name: 'A' } as never);
    await nodesApi.update('n1', { name: 'B' });
    await nodesApi.remove('n1');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('PUT');
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe('DELETE');
  });

  it('relationsApi.create / remove call the right endpoints', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ relation_id: 'r1' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await relationsApi.create('g1', {
      source_id: 'a',
      target_id: 'b',
      relation_type: 'RELATED_TO',
    });
    await relationsApi.remove('r1');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/graphs/g1/relations');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/api/relations/r1');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('DELETE');
  });

  it('templatesApi covers list / create / update / remove', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: 't1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 't1' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await templatesApi.list();
    await templatesApi.create({ name: 'A', system_prompt: 's', user_prompt: 'u' } as never);
    await templatesApi.update('t1', { name: 'B' });
    await templatesApi.remove('t1');
    expect(fetchMock.mock.calls).toHaveLength(4);
  });

  it('aiApi covers generate / getJob / approveAll / approveSome / rejectAll', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => jsonResponse({ ok: true, job_id: 'j1' }));
    await aiApi.generate({ template_id: 't1', variables: {} } as never);
    await aiApi.getJob('j1');
    await aiApi.approveAll('j1');
    await aiApi.approveSome('j1', { node_ids: ['n1'], relation_ids: [] });
    await aiApi.rejectAll('j1');
    expect(fetchMock.mock.calls).toHaveLength(5);
    expect(fetchMock.mock.calls[2]?.[0]).toContain('/approve-all');
    expect(fetchMock.mock.calls[4]?.[0]).toContain('/reject-all');
  });

  it('usersApi covers list / create / updateRole / remove', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ user_id: 'u1' }))
      .mockResolvedValueOnce(jsonResponse({ user_id: 'u1' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await usersApi.list();
    await usersApi.create({ username: 'a', password: 'b', role: 'expert' } as never);
    await usersApi.updateRole('u1', 'admin');
    await usersApi.remove('u1');
    expect(fetchMock.mock.calls).toHaveLength(4);
  });
});
