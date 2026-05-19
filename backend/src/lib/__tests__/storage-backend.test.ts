import { describe, it, expect, afterEach } from 'vitest';
import { getStorageBackend } from '../storage-backend';

describe('getStorageBackend', () => {
  const orig = process.env.STORAGE_BACKEND;
  afterEach(() => {
    if (orig === undefined) delete process.env.STORAGE_BACKEND;
    else process.env.STORAGE_BACKEND = orig;
  });

  it('defaults to neo4j when unset', () => {
    delete process.env.STORAGE_BACKEND;
    expect(getStorageBackend()).toBe('neo4j');
  });

  it('returns pg when STORAGE_BACKEND=pg', () => {
    process.env.STORAGE_BACKEND = 'pg';
    expect(getStorageBackend()).toBe('pg');
  });

  it('is case-insensitive (PG → pg)', () => {
    process.env.STORAGE_BACKEND = 'PG';
    expect(getStorageBackend()).toBe('pg');
  });

  it('falls back to neo4j on unknown values', () => {
    process.env.STORAGE_BACKEND = 'mongo';
    expect(getStorageBackend()).toBe('neo4j');
  });
});
