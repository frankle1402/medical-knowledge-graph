import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';

export const systemRouter: Router = Router();

// ---- LLM config (read-only, admin) ----
systemRouter.get('/llm', requireAuth, requireRole('admin'), (_req, res) => {
  res.json({
    base_url: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    api_key_set: Boolean(env.LLM_API_KEY && env.LLM_API_KEY.length > 0),
  });
});

// ---- AI generation logs (admin/expert) ----
const LogQuery = z.object({
  graph_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

systemRouter.get(
  '/ai-logs',
  requireAuth,
  requireRole('admin', 'expert'),
  async (req, res, next) => {
    try {
      const { graph_id, limit } = LogQuery.parse(req.query);
      const where = graph_id ? { graph_id } : {};
      const [items, total] = await Promise.all([
        prisma.aiGenerationLog.findMany({
          where,
          orderBy: { created_at: 'desc' },
          take: limit,
        }),
        prisma.aiGenerationLog.count({ where }),
      ]);
      res.json({ items, total });
    } catch (e) {
      next(e);
    }
  },
);
