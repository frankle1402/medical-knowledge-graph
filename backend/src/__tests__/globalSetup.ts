import 'dotenv/config';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function globalSetup(): Promise<void> {
  // Force the test database before any module loads Prisma client / env config.
  const testUrl =
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/knowledge_graph_test';
  process.env.DATABASE_URL = testUrl;
  process.env.POSTGRES_URL = testUrl;
  process.env.NODE_ENV = 'test';
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-please-ignore';
  }

  // Run the same migrations against the test DB
  const backendDir = path.resolve(__dirname, '..', '..');
  execSync('npx prisma migrate deploy', {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
}
