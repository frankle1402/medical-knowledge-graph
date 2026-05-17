import neo4j, { type Driver, type Session, type SessionConfig } from 'neo4j-driver';
import { env } from '../config/env.js';

/**
 * Neo4j driver singleton + parameterized query helper.
 *
 * Database selection rule:
 *   - In NODE_ENV=test → uses NEO4J_TEST_DATABASE (default 'mkgtest').
 *   - Otherwise        → uses NEO4J_DATABASE       (default 'mkg').
 *
 * If the local Neo4j Community edition does not support multiple databases,
 * the driver will fall back to the default database and tests should rely on
 * `graph_id` namespacing + `afterEach` cleanup for isolation. See
 * `backend/src/__tests__/setup.ts` for the cleanup hook (added by Agent-B).
 */

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      env.NEO4J_URI,
      neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD),
      {
        maxConnectionPoolSize: 50,
        connectionAcquisitionTimeout: 30_000,
      },
    );
  }
  return driver;
}

export function getDatabase(): string {
  return env.NODE_ENV === 'test' ? env.NEO4J_TEST_DATABASE : env.NEO4J_DATABASE;
}

/**
 * Convert Neo4j Integer values returned in records into plain JS numbers
 * (or strings when they exceed JS safe integer range). Recurses into nested
 * objects / arrays.
 */
function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (neo4j.isInt(value)) {
    const big = value as ReturnType<typeof neo4j.int>;
    return big.inSafeRange() ? big.toNumber() : big.toString();
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object') {
    // Neo4j temporal types own a toString; preserve as ISO string when possible.
    const v = value as { toString?: () => string };
    if (
      v.constructor &&
      typeof v.constructor.name === 'string' &&
      ['DateTime', 'Date', 'LocalDateTime', 'Time', 'LocalTime', 'Duration'].includes(
        v.constructor.name,
      )
    ) {
      return v.toString!();
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toPlain(val);
    }
    return out;
  }
  return value;
}

export interface RunQueryOptions {
  /** Override the database for this single call (default: getDatabase()). */
  database?: string;
  /** 'READ' uses a read-replica session if available; default 'WRITE'. */
  mode?: 'READ' | 'WRITE';
}

export async function runQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
  options: RunQueryOptions = {},
): Promise<T[]> {
  const sessionConfig: SessionConfig = {
    database: options.database ?? getDatabase(),
    defaultAccessMode: options.mode === 'READ' ? neo4j.session.READ : neo4j.session.WRITE,
  };
  const session: Session = getDriver().session(sessionConfig);
  try {
    const res = await session.run(cypher, params);
    return res.records.map((r) => toPlain(r.toObject()) as T);
  } finally {
    await session.close();
  }
}

/**
 * Verify driver connectivity. Throws if the server cannot be reached or
 * credentials are wrong. Useful for startup health checks.
 */
export async function verifyConnectivity(): Promise<void> {
  await getDriver().verifyConnectivity({ database: getDatabase() });
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
