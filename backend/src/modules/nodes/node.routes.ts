import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { NodeCreateInput, NodeUpdateInput } from '@mkg/shared';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { NodeListQuery, NodeService } from './node.service.js';

/**
 * Node routes are split across two routers because the URL prefixes differ:
 *
 *   nodeGraphRouter — mounted at `/api/graphs`
 *     - GET  /:id/nodes
 *     - POST /:id/nodes
 *
 *   nodeRouter — mounted at `/api/nodes`
 *     - PUT    /:nodeId
 *     - DELETE /:nodeId
 *     - POST   /batch-approve
 *
 * `app.ts` mounts both. This split lets the file own all node-related
 * business logic while still surfacing `/api/graphs/:id/nodes` natively.
 */
export const nodeGraphRouter: Router = Router();
nodeGraphRouter.use(requireAuth);

nodeGraphRouter.get(
  '/:id/nodes',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = NodeListQuery.parse(req.query);
      const result = await NodeService.list(req.params.id ?? '', q);
      res.json(result);
    } catch (e) {
      next(e);
    }
  },
);

nodeGraphRouter.post(
  '/:id/nodes',
  requireRole('admin', 'expert'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = NodeCreateInput.parse(req.body);
      const created_by = req.user?.id;
      const created = await NodeService.create(req.params.id ?? '', {
        ...body,
        // Manually-created nodes default to approved; AI ones use the batch API.
        status: body.status ?? 'approved',
        source: body.source ?? 'manual',
        ...(created_by ? { created_by } : {}),
      });
      if (!created) {
        res.status(404).json({ error: 'graph_not_found' });
        return;
      }
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

export const nodeRouter: Router = Router();
nodeRouter.use(requireAuth);

nodeRouter.put(
  '/:nodeId',
  requireRole('admin', 'expert'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patch = NodeUpdateInput.parse(req.body);
      const updated = await NodeService.update(req.params.nodeId ?? '', patch);
      if (!updated) {
        res.status(404).json({ error: 'node_not_found' });
        return;
      }
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

nodeRouter.delete(
  '/:nodeId',
  requireRole('admin', 'expert'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ok = await NodeService.remove(req.params.nodeId ?? '');
      if (!ok) {
        res.status(404).json({ error: 'node_not_found' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

const BatchApproveBody = z.object({
  node_ids: z.array(z.string().min(1)).min(1),
});

nodeRouter.post(
  '/batch-approve',
  requireRole('admin', 'expert'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = BatchApproveBody.parse(req.body);
      const result = await NodeService.batchApprove(body.node_ids);
      res.json(result);
    } catch (e) {
      next(e);
    }
  },
);
