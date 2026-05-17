import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  LLMAuthError,
  LLMError,
  LLMTransientError,
  chatCompletion,
} from '../../lib/llm/index.js';

describe('chatCompletion (OpenAI-compatible client)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds chat-completions request with system+user messages and returns content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await chatCompletion({
      system: 'sys-prompt',
      user: 'user-prompt',
      responseFormat: 'json_object',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-test',
    });
    expect(out).toBe('{"ok":true}');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('gpt-test');
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys-prompt' },
      { role: 'user', content: 'user-prompt' },
    ]);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('returns LLMAuthError for 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'no key',
      }),
    );
    await expect(
      chatCompletion({
        system: 's',
        user: 'u',
        baseUrl: 'https://x',
        apiKey: 'k',
        model: 'm',
      }),
    ).rejects.toBeInstanceOf(LLMAuthError);
  });

  it('returns LLMTransientError for 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'overloaded',
      }),
    );
    await expect(
      chatCompletion({
        system: 's',
        user: 'u',
        baseUrl: 'https://x',
        apiKey: 'k',
        model: 'm',
      }),
    ).rejects.toBeInstanceOf(LLMTransientError);
  });

  it('returns LLMTransientError on network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed: ECONNRESET')),
    );
    await expect(
      chatCompletion({
        system: 's',
        user: 'u',
        baseUrl: 'https://x',
        apiKey: 'k',
        model: 'm',
      }),
    ).rejects.toBeInstanceOf(LLMTransientError);
  });

  it('returns LLMError for 400 (non-retryable client error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'bad request',
      }),
    );
    const promise = chatCompletion({
      system: 's',
      user: 'u',
      baseUrl: 'https://x',
      apiKey: 'k',
      model: 'm',
    });
    await expect(promise).rejects.toBeInstanceOf(LLMError);
    await expect(promise).rejects.not.toBeInstanceOf(LLMTransientError);
    await expect(promise).rejects.not.toBeInstanceOf(LLMAuthError);
  });

  it('throws when choices[0].message.content is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
      }),
    );
    await expect(
      chatCompletion({
        system: 's',
        user: 'u',
        baseUrl: 'https://x',
        apiKey: 'k',
        model: 'm',
      }),
    ).rejects.toThrow(/choices\[0\]/);
  });
});
