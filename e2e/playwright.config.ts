import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const BACKEND_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const FRONTEND_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const MOCK_LLM_PORT = process.env.MOCK_LLM_PORT ?? '9999';
const MOCK_LLM_BASE = `http://127.0.0.1:${MOCK_LLM_PORT}/v1`;

/**
 * Worktrees never carry a .env (it's gitignored), but the backend needs the
 * real Postgres + Neo4j credentials. We hunt for a `.env` in this worktree
 * first, then walk back to the main repo root, so a developer can run the
 * suite from either place. Parse and forward the vars explicitly because
 * `dotenv/config` inside the backend reads from its own cwd, not ours.
 */
function loadEnvFile(): Record<string, string> {
  const candidates = [
    path.join(repoRoot, '.env'),
    path.join(repoRoot, 'backend', '.env'),
    // Walk up out of .claude/worktrees/<branch> back to the main repo root.
    path.resolve(repoRoot, '..', '..', '..', '.env'),
    path.resolve(repoRoot, '..', '..', '..', 'backend', '.env'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const out: Record<string, string> = {};
      const text = fs.readFileSync(p, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const k = trimmed.slice(0, eq).trim();
        let v = trimmed.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        out[k] = v;
      }
      // eslint-disable-next-line no-console
      console.log(`[playwright] loaded env from ${p} (${Object.keys(out).length} vars)`);
      return out;
    }
  }
  // eslint-disable-next-line no-console
  console.warn('[playwright] no .env found; backend will use defaults');
  return {};
}

const fileEnv = loadEnvFile();

// Backend env. We override LLM_BASE_URL so the orchestrator hits our mock
// instead of api.openai.com. Postgres / Neo4j coordinates inherit from the
// developer's .env file (parsed above).
const backendEnv: Record<string, string> = {
  ...(process.env as Record<string, string>),
  ...fileEnv,
  NODE_ENV: 'development',
  PORT: '4000',
  LLM_BASE_URL: MOCK_LLM_BASE,
  LLM_API_KEY: 'sk-mock',
  LLM_MODEL: 'mock-model',
};

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1, // serialize: tests share the live PG/Neo4j databases.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: FRONTEND_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // Mock LLM must be ready BEFORE backend boots, because env.LLM_BASE_URL
      // is read once at module load time. Playwright launches webServers in
      // order but waits on each `url` health check — so listing mock-llm
      // first guarantees backend can reach it on first /chat/completions.
      command: 'node mock-llm.mjs',
      cwd: __dirname,
      url: `http://127.0.0.1:${MOCK_LLM_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { MOCK_LLM_PORT },
    },
    {
      command: 'npm -w backend run dev',
      cwd: repoRoot,
      url: `${BACKEND_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: backendEnv,
    },
    {
      command: 'npm -w frontend run dev',
      cwd: repoRoot,
      url: FRONTEND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
