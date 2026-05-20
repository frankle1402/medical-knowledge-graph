import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient, configureApiClient } from '../client';
import { ApiError } from '../error';
import { tokenStorage } from '../token';

describe('apiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    tokenStorage.clear();
    configureApiClient({ baseUrl: '', onUnauthorized: null });
  });

  it('serialises JSON body and sets Content-Type', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await apiClient.post('/api/x', { a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('attaches Authorization header when token is present', async () => {
    tokenStorage.set('token-abc');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await apiClient.get('/api/me');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-abc');
  });

  it('skips auth header when skipAuth is true', async () => {
    tokenStorage.set('token-abc');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await apiClient.post(
      '/api/auth/login',
      { username: 'u', password: 'p' },
      {
        skipAuth: true,
      },
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('clears token and calls onUnauthorized on 401', async () => {
    tokenStorage.set('token-abc');
    const onUnauthorized = vi.fn();
    configureApiClient({ onUnauthorized });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'no' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(apiClient.get('/api/me')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalled();
    expect(tokenStorage.get()).toBeNull();
  });

  it('throws ApiError with message extracted from { error: { message } }', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'bad input', code: 'E1' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    try {
      await apiClient.get('/api/x');
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('bad input');
      expect((err as ApiError).code).toBe('E1');
      expect((err as ApiError).status).toBe(400);
    }
  });

  it('appends query parameters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await apiClient.get('/api/x', { query: { a: 1, b: 'two', c: undefined } });
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain('a=1');
    expect(url).toContain('b=two');
    expect(url).not.toContain('c=');
  });

  it('returns undefined for 204 No Content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const out = await apiClient.delete('/api/x');
    expect(out).toBeUndefined();
  });

  it('exposes Retry-After header on ApiError when present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'rate-limited' } }), {
        status: 503,
        headers: { 'content-type': 'application/json', 'Retry-After': '7' },
      }),
    );
    try {
      await apiClient.get('/api/x');
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).retryAfter).toBe(7);
    }
  });

  it('leaves retryAfter undefined when header missing or non-numeric', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'fail' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    try {
      await apiClient.get('/api/x');
      expect.fail('should throw');
    } catch (err) {
      expect((err as ApiError).retryAfter).toBeUndefined();
    }
  });
});
