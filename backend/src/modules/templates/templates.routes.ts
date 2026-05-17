import { Router } from 'express';
import { z } from 'zod';
import { TemplateVariable } from '@mkg/shared';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { templatesService, HttpError } from './templates.service.js';

export const templatesRouter: Router = Router();
templatesRouter.use(requireAuth);

const InputBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  variables: z.array(TemplateVariable).default([]),
  system_prompt: z.string().min(1),
  user_prompt_template: z.string().min(1),
  output_schema: z.record(z.string(), z.unknown()).optional(),
  created_by: z.string().uuid().optional(),
});

const PatchBody = InputBody.partial();

templatesRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await templatesService.list());
  } catch (e) {
    next(e);
  }
});

templatesRouter.get('/:id', async (req, res, next) => {
  try {
    const t = await templatesService.get(req.params.id ?? '');
    if (!t) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(t);
  } catch (e) {
    next(e);
  }
});

templatesRouter.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const body = InputBody.parse(req.body);
    res.status(201).json(await templatesService.create(body));
  } catch (e) {
    next(e);
  }
});

templatesRouter.put('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const patch = PatchBody.parse(req.body);
    res.json(await templatesService.update(req.params.id ?? '', patch));
  } catch (e) {
    if (e instanceof HttpError) {
      res.status(e.status).json({ error: e.message, code: e.code });
      return;
    }
    next(e);
  }
});

templatesRouter.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await templatesService.softDelete(req.params.id ?? '');
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) {
      res.status(e.status).json({ error: e.message, code: e.code });
      return;
    }
    next(e);
  }
});
