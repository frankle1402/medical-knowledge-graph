import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import {
  CreateGraphSchema,
  UpdateGraphSchema,
  GraphService,
} from './graph.service.js';

/**
 * Routes mounted at `/api/graphs`.
 *
 * - GET    /                    list — any authenticated user
 * - POST   /                    create — admin / expert
 * - GET    /:id                 detail (graph + nodes + relations) — auth
 * - PUT    /:id                 update — admin / expert
 * - DELETE /:id                 delete — admin / expert
 * - GET    /:id/export          download as JSON — auth
 */
export const graphRouter: Router = Router();
graphRouter.use(requireAuth);

graphRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await GraphService.list());
  } catch (e) {
    next(e);
  }
});

const ClientCreateBody = CreateGraphSchema.omit({ created_by: true });

graphRouter.post(
  '/',
  requireRole('admin', 'expert'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = ClientCreateBody.parse(req.body);
      const created_by = req.user?.id;
      if (!created_by) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const graph = await GraphService.create({ ...body, created_by });
      res.status(201).json(graph);
    } catch (e) {
      next(e);
    }
  },
);

graphRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const detail = await GraphService.findById(req.params.id ?? '');
    if (!detail) {
      res.status(404).json({ error: 'graph_not_found' });
      return;
    }
    res.json(detail);
  } catch (e) {
    next(e);
  }
});

graphRouter.put(
  '/:id',
  requireRole('admin', 'expert'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patch = UpdateGraphSchema.parse(req.body);
      const updated = await GraphService.update(req.params.id ?? '', patch);
      if (!updated) {
        res.status(404).json({ error: 'graph_not_found' });
        return;
      }
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

graphRouter.delete(
  '/:id',
  requireRole('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const removed = await GraphService.remove(req.params.id ?? '');
      if (!removed) {
        res.status(404).json({ error: 'graph_not_found' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

// JSON export — Task 14. Plan said POST originally; review-report P1 + the
// shared OpenAPI registry switched to GET so the browser can download via
// a plain anchor click. Keeping GET to match the contract.
graphRouter.get(
  '/:id/export',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id ?? '';
      const data = await GraphService.exportToJson(id);
      if (!data) {
        res.status(404).json({ error: 'graph_not_found' });
        return;
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="graph-${id}.json"`,
      );
      res.send(JSON.stringify(data, null, 2));
    } catch (e) {
      next(e);
    }
  },
);

// Compile-time guard so unused `z` import remains stable if the body schemas
// are stripped by tree-shaking. Kept for future request schemas (`POST /:id/export`).
void z;
