/**
 * RAG search routes — mounted at `/api/graphs` so the path becomes
 * `/api/graphs/:graph_id/search`.
 *
 * Error policy
 * ------------
 * - 400: payload fails SearchInput.parse (handled by global errorHandler)
 * - 401: requireAuth middleware
 * - 404: graph_id doesn't exist (mirrors the graph CRUD contract)
 * - 503 + Retry-After: OpenAI transient failure during embed(). We don't
 *   surface internal stack traces — just enough for the client to retry.
 *
 * Anything else falls through to the global errorHandler.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePgBackend } from '../../middleware/requirePgBackend.js';
import { GraphService } from '../graphs/graph.service.js';
import { SearchInput, SearchService } from './search.service.js';

export const searchRouter: Router = Router();
searchRouter.use(requireAuth);
searchRouter.use(requirePgBackend);

interface OpenAIErrorLike {
  status?: number;
  message?: string;
}

function isTransientOpenAI(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as OpenAIErrorLike).status;
  if (typeof status !== 'number') return false;
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
}

searchRouter.post(
  '/:graph_id/search',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { graph_id } = req.params;
      if (!graph_id) {
        res.status(400).json({ error: 'graph_id_required' });
        return;
      }
      const detail = await GraphService.findById(graph_id);
      if (!detail) {
        res.status(404).json({ error: 'graph_not_found' });
        return;
      }
      const input = SearchInput.parse(req.body ?? {});
      const result = await SearchService.search(graph_id, input);
      res.json(result);
    } catch (err) {
      if (isTransientOpenAI(err)) {
        // Be polite about retries: 5 seconds is a sane floor for OpenAI's
        // tier-1 RPM limits without spamming the upstream.
        res.set('Retry-After', '5');
        res.status(503).json({ error: 'embedding_service_unavailable' });
        return;
      }
      next(err);
    }
  },
);
