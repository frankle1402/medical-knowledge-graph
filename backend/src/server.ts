import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { registerEmbeddingHook, whenIdle } from './services/embedding/queue.js';

const app = createApp();

// Register the Pack C node-upsert -> embedding hook once at process startup.
// Tests that call createApp() directly skip this so they don't trigger
// background OpenAI calls.
registerEmbeddingHook();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'backend listening');
});

/**
 * Graceful shutdown. We stop accepting new connections immediately, then
 * give the embedding queue up to 5s to drain so in-flight pgvector writes
 * land. Anything still pending after the timeout is a NULL embedding —
 * `backfill-embeddings` covers that on the next run.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  server.close();
  try {
    await Promise.race([
      whenIdle(),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (err) {
    logger.warn({ err }, 'embedding queue did not drain in time');
  }
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
