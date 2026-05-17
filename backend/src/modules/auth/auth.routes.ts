import { Router } from 'express';
import { z } from 'zod';
import { login, getMe, AuthError } from './auth.service.js';
import { requireAuth } from '../../middleware/auth.js';

export const authRouter: Router = Router();

const LoginBody = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const body = LoginBody.parse(req.body);
    const result = await login(body.username, body.password);
    res.json(result);
  } catch (e) {
    if (e instanceof AuthError) {
      res.status(e.status).json({ error: e.message, code: e.code });
      return;
    }
    next(e);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await getMe(req.user!.id);
    res.json(user);
  } catch (e) {
    if (e instanceof AuthError) {
      res.status(e.status).json({ error: e.message, code: e.code });
      return;
    }
    next(e);
  }
});

authRouter.post('/logout', requireAuth, (_req, res) => {
  // Stateless JWT — no server-side session to invalidate. Client drops the token.
  res.json({ ok: true });
});
