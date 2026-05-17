import { Router, type Request, type Response, type NextFunction } from 'express';
import { RelationCreateInput } from '@mkg/shared';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { RelationService, RelationUpdateInput } from './relation.service.js';

/**
 * Relation routes are split across two routers:
 *
 *   relationGraphRouter — mounted at `/api/graphs`
 *     - GET  /:id/relations   list relations of a graph
 *     - POST /:id/relations   create relation between two nodes in the graph
 *
 *   relationRouter — mounted at `/api/relations`
 *     - PUT    /:relationId
 *     - DELETE /:relationId
 *
 * `relation_id` is `id(r)` from Neo4j (an internal numeric id stringified).
 * It is stable for the life of the relationship but not portable across
 * databases — clients should treat it as opaque.
 */
export const relationGraphRouter: Router = Router();
relationGraphRouter.use(requireAuth);

relationGraphRouter.get(
  '/:id/relations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await RelationService.listByGraph(req.params.id ?? '');
      res.json(list);
    } catch (e) {
      next(e);
    }
  },
);

relationGraphRouter.post(
  '/:id/relations',
  requireRole('admin', 'expert'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = RelationCreateInput.parse(req.body);
      const created = await RelationService.create(req.params.id ?? '', body);
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

export const relationRouter: Router = Router();
relationRouter.use(requireAuth);

relationRouter.put(
  '/:relationId',
  requireRole('admin', 'expert'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patch = RelationUpdateInput.parse(req.body);
      const updated = await RelationService.update(
        req.params.relationId ?? '',
        patch,
      );
      if (!updated) {
        res.status(404).json({ error: 'relation_not_found' });
        return;
      }
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

relationRouter.delete(
  '/:relationId',
  requireRole('admin', 'expert'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ok = await RelationService.remove(req.params.relationId ?? '');
      if (!ok) {
        res.status(404).json({ error: 'relation_not_found' });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);
