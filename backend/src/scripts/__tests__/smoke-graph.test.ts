import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * Wrap the smoke script in a vitest case so CI runs it alongside unit tests.
 *
 * Skips automatically when Neo4j is not reachable (the script throws and we
 * swallow that here — the unit tests already prove correctness against a
 * live database when one is configured).
 */
describe('smoke graph e2e', () => {
  it('runs end-to-end against a live Neo4j', () => {
    const script = path.resolve(
      __dirname,
      '..',
      '..',
      'scripts',
      'smoke-graph.ts',
    );
    let output = '';
    try {
      output = execSync(`npx tsx "${script}"`, {
        encoding: 'utf-8',
        env: { ...process.env, NODE_ENV: 'test' },
        timeout: 60_000,
      });
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string };
      const combined = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
      if (
        /unreachable|ServiceUnavailable|ECONNREFUSED|Failed to connect/i.test(
          combined,
        )
      ) {
        // No Neo4j available in this environment — skip rather than fail.
        // This matches the project DoD: smoke is a supplementary gate, not
        // a blocker for non-graph layers.
        // eslint-disable-next-line no-console
        console.warn('[smoke] Neo4j unreachable — skipping');
        return;
      }
      throw err;
    }
    expect(output).toContain('SMOKE PASS');
  }, 60_000);
});
