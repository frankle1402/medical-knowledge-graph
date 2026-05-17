import { Router } from 'express';
import { z } from 'zod';
import { UserRole } from '@mkg/shared';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { usersService, HttpError } from './users.service.js';

export const usersRouter: Router = Router();
usersRouter.use(requireAuth, requireRole('admin'));

const CreateBody = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  role: UserRole,
});
const UpdateRoleBody = z.object({ role: UserRole });

usersRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await usersService.list());
  } catch (e) {
    next(e);
  }
});

usersRouter.post('/', async (req, res, next) => {
  try {
    const body = CreateBody.parse(req.body);
    res.status(201).json(await usersService.create(body));
  } catch (e) {
    if (e instanceof HttpError) {
      res.status(e.status).json({ error: e.message, code: e.code });
      return;
    }
    next(e);
  }
});

usersRouter.put('/:id/role', async (req, res, next) => {
  try {
    const body = UpdateRoleBody.parse(req.body);
    res.json(await usersService.updateRole(req.params.id ?? '', body.role));
  } catch (e) {
    if (e instanceof HttpError) {
      res.status(e.status).json({ error: e.message, code: e.code });
      return;
    }
    next(e);
  }
});

usersRouter.delete('/:id', async (req, res, next) => {
  try {
    res.json(await usersService.remove(req.params.id ?? '', req.user!.id));
  } catch (e) {
    if (e instanceof HttpError) {
      res.status(e.status).json({ error: e.message, code: e.code });
      return;
    }
    next(e);
  }
});
