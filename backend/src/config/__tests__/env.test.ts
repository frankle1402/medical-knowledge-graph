import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const ORIG_ENV = { ...process.env };

describe('env config', () => {
  beforeEach(() => {
    // Reset relevant env keys before each test
    process.env = { ...ORIG_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('reads PORT and DATABASE_URL', async () => {
    process.env.JWT_SECRET = 'test-secret-12345';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.PORT = '4001';
    const mod = await import('../env?nocache=' + Date.now());
    expect(mod.env.PORT).toBe(4001);
    expect(mod.env.DATABASE_URL).toContain('postgresql');
  });

  it('falls back to POSTGRES_URL when DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_URL = 'postgresql://u:p@localhost:5432/fallback';
    const mod = await import('../env?nocache=' + Date.now());
    expect(mod.env.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/fallback');
  });

  it('uses default JWT_SECRET when not set', async () => {
    delete process.env.JWT_SECRET;
    const mod = await import('../env?nocache=' + Date.now());
    expect(mod.env.JWT_SECRET).toBeTruthy();
  });

  it('rejects too-short JWT_SECRET', async () => {
    process.env.JWT_SECRET = 'a';
    await expect(import('../env?nocache=' + Date.now())).rejects.toThrow(/JWT_SECRET/);
  });
});
