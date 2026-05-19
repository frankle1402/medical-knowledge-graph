import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { registerEmbeddingHook } from './services/embedding/queue.js';

const app = createApp();

// Register the Pack C node-upsert -> embedding hook once at process startup.
// Tests that call createApp() directly skip this so they don't trigger
// background OpenAI calls.
registerEmbeddingHook();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'backend listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
