import { describe, it, expect, afterAll } from 'vitest';
import { getDriver, runQuery, closeDriver, getDatabase } from '../neo4j';

describe('neo4j driver', () => {
  afterAll(async () => {
    await closeDriver();
  });

  it('returns a driver singleton', () => {
    const a = getDriver();
    const b = getDriver();
    expect(a).toBe(b);
  });

  it('selects the test database in NODE_ENV=test', () => {
    expect(getDatabase()).toBe(process.env.NEO4J_TEST_DATABASE ?? 'mkgtest');
  });

  it('runs a basic RETURN 1 query', async () => {
    const result = await runQuery<{ x: number }>('RETURN 1 AS x');
    expect(result[0]?.x).toBe(1);
  });

  it('passes parameters through and returns them', async () => {
    const result = await runQuery<{ name: string }>('RETURN $name AS name', {
      name: '李智高',
    });
    expect(result[0]?.name).toBe('李智高');
  });

  it('rejects on invalid Cypher (proves error surfacing)', async () => {
    await expect(runQuery('THIS IS NOT CYPHER')).rejects.toBeTruthy();
  });

  it('coerces Neo4j Integer to JS number in records', async () => {
    const result = await runQuery<{ n: number }>('RETURN 42 AS n');
    expect(result[0]?.n).toBe(42);
    expect(typeof result[0]?.n).toBe('number');
  });
});
