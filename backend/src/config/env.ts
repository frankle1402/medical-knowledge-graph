import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment configuration for the backend.
 *
 * Database URL resolution:
 * - In test mode (NODE_ENV=test or TEST_DATABASE_URL is forced by globalSetup)
 *   the test runner sets DATABASE_URL = TEST_DATABASE_URL before this module loads.
 * - In dev/prod, DATABASE_URL falls back to POSTGRES_URL (kept in .env.example).
 */
const Schema = z
  .object({
    PORT: z.coerce.number().int().positive().default(4000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    JWT_SECRET: z.string().min(8, 'JWT_SECRET must be set (min 8 chars)').default('change-me-in-production'),
    JWT_EXPIRES_IN: z.string().default('12h'),
    DATABASE_URL: z.string().optional(),
    POSTGRES_URL: z.string().optional(),
    TEST_DATABASE_URL: z.string().optional(),
    NEO4J_URI: z.string().default('bolt://localhost:7687'),
    NEO4J_USER: z.string().default('neo4j'),
    NEO4J_PASSWORD: z.string().default('neo4j-password'),
    NEO4J_DATABASE: z.string().default('mkg'),
    NEO4J_TEST_DATABASE: z.string().default('mkgtest'),
    LLM_BASE_URL: z.string().default('https://api.openai.com/v1'),
    LLM_API_KEY: z.string().default(''),
    LLM_MODEL: z.string().default('gpt-4o-mini'),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
  })
  .transform((raw) => {
    const dbUrl = raw.DATABASE_URL ?? raw.POSTGRES_URL;
    return {
      ...raw,
      DATABASE_URL: dbUrl,
      POSTGRES_URL: dbUrl,
    };
  });

export const env = Schema.parse(process.env);

// Ensure Prisma sees DATABASE_URL even if only POSTGRES_URL was provided
if (env.DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = env.DATABASE_URL;
}
