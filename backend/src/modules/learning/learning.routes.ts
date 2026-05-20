import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePgBackend } from '../../middleware/requirePgBackend.js';
import {
  KnowledgeGapInput,
  LearningPathQuery,
  LearningService,
  SynonymQuery,
} from './learning.service.js';

/**
 * Pack D learning routes.
 *
 * Mounted at `/api` in `app.ts`; the full request paths land on:
 *   GET  /api/nodes/:node_id/learning-path
 *   POST /api/graphs/:graph_id/knowledge-gap
 *   GET  /api/graphs/:graph_id/synonym-candidates
 *
 * Mounting at `/api` rather than `/api/learning` matches the API contract
 * the frontend (Pack E) consumes — it expects these paths to live on the
 * existing resource hierarchies, not under a parallel `learning` prefix.
 *
 * `requireAuth` is attached per-route rather than via `router.use(...)`
 * so unmatched /api/* requests (notably /api/docs/) fall through to the
 * swagger handler without being intercepted by the auth middleware on
 * this router.
 */
export const learningRoutes: Router = Router();

learningRoutes.get(
  '/nodes/:node_id/learning-path',
  requireAuth,
  requirePgBackend,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = LearningPathQuery.parse(req.query);
      const r = await LearningService.learningPath(
        req.params.node_id ?? '',
        q,
      );
      if (!r) {
        res.status(404).json({ error: 'node_not_found' });
        return;
      }
      res.json(r);
    } catch (e) {
      next(e);
    }
  },
);

learningRoutes.post(
  '/graphs/:graph_id/knowledge-gap',
  requireAuth,
  requirePgBackend,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = KnowledgeGapInput.parse(req.body);
      const r = await LearningService.knowledgeGap(
        req.params.graph_id ?? '',
        body,
      );
      res.json(r);
    } catch (e) {
      next(e);
    }
  },
);

learningRoutes.get(
  '/graphs/:graph_id/synonym-candidates',
  requireAuth,
  requirePgBackend,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = SynonymQuery.parse(req.query);
      const candidates = await LearningService.synonymCandidates(
        req.params.graph_id ?? '',
        q,
      );
      res.json({ candidates });
    } catch (e) {
      next(e);
    }
  },
);
