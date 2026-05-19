import { describe, it, expect, beforeEach, vi } from 'vitest';
import { embed, embedBatch, nodeEmbeddingText, EMBEDDING_DIM, _resetClient } from '../openai';

// Mock the openai SDK — never make real API calls in tests.
const createMock = vi.fn();
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: {
        create: (...args: unknown[]) => createMock(...args),
      },
    })),
  };
});

function makeVec(fill = 0.1): number[] {
  return new Array(EMBEDDING_DIM).fill(fill);
}

describe('embed', () => {
  beforeEach(() => {
    createMock.mockReset();
    _resetClient();
  });

  it('returns a 1536-dim vector', async () => {
    createMock.mockResolvedValue({ data: [{ embedding: makeVec() }] });
    const v = await embed('心率失常');
    expect(v.length).toBe(EMBEDDING_DIM);
    expect(v[0]).toBe(0.1);
  });

  it('throws on empty input without calling the API', async () => {
    await expect(embed('')).rejects.toThrow();
    await expect(embed('   ')).rejects.toThrow();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('throws when the API returns the wrong dimension', async () => {
    createMock.mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] });
    await expect(embed('x')).rejects.toThrow(/unexpected dim/);
  });

  it('truncates input over 8000 chars', async () => {
    createMock.mockResolvedValue({ data: [{ embedding: makeVec() }] });
    const big = 'a'.repeat(9000);
    await embed(big);
    const call = createMock.mock.calls[0]?.[0] as { input: string };
    expect(call.input.length).toBe(8000);
  });
});

describe('embedBatch', () => {
  beforeEach(() => {
    createMock.mockReset();
    _resetClient();
  });

  it('returns one vector per input', async () => {
    createMock.mockResolvedValue({
      data: [
        { embedding: makeVec(0.1) },
        { embedding: makeVec(0.2) },
        { embedding: makeVec(0.3) },
      ],
    });
    const vecs = await embedBatch(['a', 'b', 'c']);
    expect(vecs).toHaveLength(3);
    expect(vecs[0]?.[0]).toBe(0.1);
    expect(vecs[2]?.[0]).toBe(0.3);
  });

  it('returns [] for empty input without calling the API', async () => {
    const out = await embedBatch([]);
    expect(out).toEqual([]);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('throws when any input is empty', async () => {
    await expect(embedBatch(['ok', ''])).rejects.toThrow();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('throws when any returned vector has wrong dimension', async () => {
    createMock.mockResolvedValue({
      data: [{ embedding: makeVec() }, { embedding: [0.1] }],
    });
    await expect(embedBatch(['a', 'b'])).rejects.toThrow(/unexpected dim/);
  });
});

describe('nodeEmbeddingText', () => {
  it('combines name + description + string tags', () => {
    expect(
      nodeEmbeddingText({ name: 'A', description: 'B', tags: ['c', 'd'] }),
    ).toBe('A\nB\nc, d');
  });

  it('skips description when null/empty', () => {
    expect(nodeEmbeddingText({ name: 'A', description: null })).toBe('A');
    expect(nodeEmbeddingText({ name: 'A', description: '' })).toBe('A');
  });

  it('skips tags when not an array of strings', () => {
    expect(nodeEmbeddingText({ name: 'A', tags: 'oops' })).toBe('A');
    expect(nodeEmbeddingText({ name: 'A', tags: [] })).toBe('A');
    expect(nodeEmbeddingText({ name: 'A', tags: [1, 2] })).toBe('A');
  });

  it('handles only-name input', () => {
    expect(nodeEmbeddingText({ name: '心率失常' })).toBe('心率失常');
  });
});
