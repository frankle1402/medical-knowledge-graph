import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';
import type { UserRole } from '@mkg/shared';

declare module 'express-serve-static-core' {
  // augment Request with optional user injected by requireAuth
  // both `id` and `sub` are populated for downstream convenience
  interface Request {
    user?: JwtPayload;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing_token' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

/**
 * Role guard. Accepts both calling forms:
 *   requireRole('admin', 'expert')
 *   requireRole(['admin', 'expert'])
 */
export function requireRole(
  ...roles: Array<UserRole | UserRole[]>
): (req: Request, res: Response, next: NextFunction) => void {
  const flat = roles.flat() as UserRole[];
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    if (!flat.includes(req.user.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
