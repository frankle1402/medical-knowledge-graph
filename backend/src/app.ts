import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { mountSwagger } from './lib/openapi.js';

import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { templatesRouter } from './modules/templates/templates.routes.js';
import { systemRouter } from './modules/system/system.routes.js';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  if (env.NODE_ENV !== 'test') {
    app.use(pinoHttp({ logger }));
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: process.env.npm_package_version ?? '0.1.0' });
  });

  // ===== MOUNT-POINTS (Agent-A owned) =====
  // The four routers below are owned by Agent-A.
  // Other agents must NOT modify these mount lines.
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/system', systemRouter);

  // ===== MOUNT-POINTS (Agent-B reserved) =====
  // Agent-B will add: app.use('/api/graphs', graphsRouter)
  //                   app.use('/api/nodes', nodesRouter)
  //                   app.use('/api/relations', relationsRouter)

  // ===== MOUNT-POINTS (Agent-C reserved) =====
  // Agent-C will add: app.use('/api/ai', aiRouter)

  // Swagger UI (consumes openapi.yaml produced by @mkg/shared)
  mountSwagger(app);

  app.use(errorHandler);

  return app;
}
