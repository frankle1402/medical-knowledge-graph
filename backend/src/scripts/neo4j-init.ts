/**
 * Initialize Neo4j schema (constraints + indexes) for the knowledge graph.
 *
 * Idempotent: every statement uses `IF NOT EXISTS` so re-running is safe.
 *
 * Run with:
 *   npm -w backend run neo4j:init
 *
 * Database: uses `getDatabase()` from `lib/neo4j` which honors NODE_ENV.
 * In NODE_ENV=test the test database is initialized instead.
 */
import { runQuery, closeDriver, getDatabase } from '../lib/neo4j.js';

const STATEMENTS = [
  // --- Uniqueness constraints ----------------------------------------
  'CREATE CONSTRAINT node_id_unique IF NOT EXISTS FOR (n:Node) REQUIRE n.node_id IS UNIQUE',
  'CREATE CONSTRAINT graph_id_unique IF NOT EXISTS FOR (g:Graph) REQUIRE g.graph_id IS UNIQUE',

  // --- Node lookup indexes -------------------------------------------
  'CREATE INDEX node_type_idx IF NOT EXISTS FOR (n:Node) ON (n.node_type)',
  'CREATE INDEX node_status_idx IF NOT EXISTS FOR (n:Node) ON (n.status)',
  'CREATE INDEX node_name_idx IF NOT EXISTS FOR (n:Node) ON (n.name)',

  // --- AI pipeline (Task 15a) ----------------------------------------
  // Required by Agent-C — locating candidate nodes/relations by ai_job_id.
  'CREATE INDEX node_ai_job_idx IF NOT EXISTS FOR (n:Node) ON (n.ai_job_id)',
];

export async function initNeo4jSchema(): Promise<void> {
  const db = getDatabase();
  // eslint-disable-next-line no-console
  console.log(`Initializing Neo4j schema in database "${db}" ...`);
  for (const stmt of STATEMENTS) {
    // eslint-disable-next-line no-console
    console.log('>', stmt);
    await runQuery(stmt);
  }
  // eslint-disable-next-line no-console
  console.log('Neo4j schema initialized.');
}

// Run when invoked directly via `tsx`.
const invokedDirectly = (() => {
  try {
    const argv1 = process.argv[1] ?? '';
    return argv1.includes('neo4j-init');
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  initNeo4jSchema()
    .then(() => closeDriver())
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error('neo4j-init failed:', err);
      try {
        await closeDriver();
      } catch {
        // ignore
      }
      process.exit(1);
    });
}
