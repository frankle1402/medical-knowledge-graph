import { beforeEach, afterAll } from 'vitest';
import { prisma } from '../lib/prisma';
import { runQuery, closeDriver } from '../lib/neo4j';

// One-shot guard so that "Neo4j down" only complains once per worker.
let neo4jCleanupAvailable: boolean | null = null;

// Each test file starts with a clean slate, except for migration metadata.
// Order matters: child tables before parent.
//
// Postgres cleanup uses TRUNCATE ... RESTART IDENTITY CASCADE to wipe
// graphs / nodes / relations between cases (CASCADE handles FK chains and
// RESTART IDENTITY resets the BIGSERIAL relation_id so tests can rely on
// freshly low ids per case).
//
// Neo4j cleanup uses MATCH ... DETACH DELETE on the test database. If the
// local Neo4j Community edition does not support multiple databases, the
// driver falls back to the default db; isolation then relies on graph_id /
// ai_job_id namespacing rather than database separation.
beforeEach(async () => {
  await prisma.aiGenerationLog.deleteMany();
  await prisma.promptTemplate.deleteMany();
  await prisma.user.deleteMany();

  // Pack B graph data lives in Postgres when STORAGE_BACKEND=pg. Always
  // truncate so tests are independent regardless of the active backend.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "relations", "nodes", "graphs" RESTART IDENTITY CASCADE',
  );

  // Clean every Graph + Node + dangling relation in the test Neo4j db.
  // DETACH DELETE removes attached relationships in a single statement.
  if (neo4jCleanupAvailable === false) return;
  try {
    await runQuery('MATCH (n) DETACH DELETE n');
    neo4jCleanupAvailable = true;
  } catch (err) {
    if (neo4jCleanupAvailable === null) {
      // Print once so noise is bounded; subsequent tests just skip.
      // eslint-disable-next-line no-console
      console.warn(
        '[test setup] Neo4j unreachable — graph/node/relation suites will fail.',
        (err as Error).message,
      );
    }
    neo4jCleanupAvailable = false;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeDriver();
});

