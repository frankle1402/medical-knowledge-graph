import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { chatCompletion } from '../../lib/llm/openai-client.js';
import { LLMAuthError, LLMTransientError } from '../../lib/llm/errors.js';
import { getMaskedLlmConfig, updateLlmConfig, getLlmConfig } from './llm-config.service.js';

export const systemRouter: Router = Router();

// ---- LLM config (admin) ----
// GET returns masked config + source (db|env) for each field.
systemRouter.get('/llm', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    res.json(await getMaskedLlmConfig());
  } catch (e) {
    next(e);
  }
});

// PUT updates DB-backed overrides. Pass null to clear a field (falls back to env).
// Empty string for api_key is treated as "no change" so admins can edit base_url
// without re-typing the key.
const LlmUpdateBody = z.object({
  base_url: z.string().url().or(z.literal('')).nullable().optional(),
  api_key: z.string().nullable().optional(),
  model: z.string().min(1).or(z.literal('')).nullable().optional(),
  timeout_ms: z.number().int().min(1000).max(600_000).nullable().optional(),
});

systemRouter.put('/llm', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const body = LlmUpdateBody.parse(req.body);
    const patch: Record<string, string | number | null> = {};
    if (body.base_url !== undefined) patch.base_url = body.base_url === '' ? null : body.base_url;
    if (body.model !== undefined) patch.model = body.model === '' ? null : body.model;
    if (body.timeout_ms !== undefined) patch.timeout_ms = body.timeout_ms;
    // empty string => skip (don't overwrite); null => clear
    if (body.api_key !== undefined && body.api_key !== '') patch.api_key = body.api_key;
    const userId = (req as { user?: { id?: string } }).user?.id ?? 'system';
    await updateLlmConfig(patch, userId);
    res.json(await getMaskedLlmConfig());
  } catch (e) {
    next(e);
  }
});

// POST /api/system/llm/test  — admin only.
// Sends a minimal chat completion using either the request-supplied config
// (preview before save) or the currently saved config (when body is empty).
// Times out independently per call so a misconfigured base_url won't hang.
const LlmTestBody = z
  .object({
    base_url: z.string().url().optional(),
    api_key: z.string().optional(),
    model: z.string().min(1).optional(),
    timeout_ms: z.number().int().min(1000).max(60_000).optional(),
  })
  .default({});

systemRouter.post('/llm/test', requireAuth, requireRole('admin'), async (req, res) => {
  const body = LlmTestBody.parse(req.body ?? {});
  const saved = await getLlmConfig();
  // body.api_key === '' means "use saved" — empty means caller didn't retype it
  const apiKey = body.api_key && body.api_key.length > 0 ? body.api_key : saved.api_key;
  const cfg = {
    baseUrl: body.base_url ?? saved.base_url,
    apiKey,
    model: body.model ?? saved.model,
    // cap at 30s for the test call so we don't make admins stare
    timeoutMs: Math.min(body.timeout_ms ?? saved.timeout_ms, 30_000),
  };

  if (!cfg.apiKey) {
    res.status(400).json({
      ok: false,
      stage: 'config',
      error: 'API Key 未配置（请先填写并保存，或在测试时一并填入）',
    });
    return;
  }

  const startedAt = Date.now();
  try {
    const reply = await chatCompletion({
      system: 'You are a connection test. Reply in plain text.',
      user: 'Reply with the single word: pong',
      temperature: 0,
      ...cfg,
    });
    res.json({
      ok: true,
      latency_ms: Date.now() - startedAt,
      model: cfg.model,
      base_url: cfg.baseUrl,
      sample_reply: reply.slice(0, 200),
    });
  } catch (err) {
    let stage: 'auth' | 'network' | 'parse' | 'unknown' = 'unknown';
    if (err instanceof LLMAuthError) stage = 'auth';
    else if (err instanceof LLMTransientError) stage = 'network';
    else if (err instanceof Error && /HTML|JSON/i.test(err.message)) stage = 'parse';
    res.status(200).json({
      ok: false,
      stage,
      latency_ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
