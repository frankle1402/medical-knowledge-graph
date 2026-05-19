import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Default to the Pack B Postgres path. The Neo4j fallback is exercised
    // via the `test:neo4j` script which sets STORAGE_BACKEND=neo4j up-front;
    // we honor an already-set value so that override works.
    env: {
      STORAGE_BACKEND: process.env.STORAGE_BACKEND ?? 'pg',
    },
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/__tests__/setup.ts'],
    globalSetup: ['./src/__tests__/globalSetup.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        'src/index.ts',
        'src/server.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
        'src/middleware/auth.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/lib/jwt.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
});
