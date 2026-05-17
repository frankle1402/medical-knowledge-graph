import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { UserRole } from '@mkg/shared';

/**
 * JWT payload shape.
 *
 * Both `sub` and `id` are accepted on the input; only one is required.
 * The middleware will normalize so `req.user.id` and `req.user.sub`
 * are both populated downstream.
 */
export interface JwtPayloadInput {
  sub?: string;
  id?: string;
  username?: string;
  role: UserRole;
}

export interface JwtPayload {
  sub: string;
  id: string;
  username?: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export function signToken(payload: JwtPayloadInput): string {
  const sub = payload.sub ?? payload.id;
  if (!sub) {
    throw new Error('signToken: payload requires sub or id');
  }
  const body: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub,
    id: sub,
    role: payload.role,
    ...(payload.username ? { username: payload.username } : {}),
  };
  const expiresIn = env.JWT_EXPIRES_IN as NonNullable<SignOptions['expiresIn']>;
  return jwt.sign(body, env.JWT_SECRET, { expiresIn });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as Record<string, unknown>;
  const sub = (decoded.sub as string | undefined) ?? (decoded.id as string | undefined);
  if (!sub) {
    throw new Error('jwt: missing sub/id');
  }
  const role = decoded.role as UserRole;
  if (!role) {
    throw new Error('jwt: missing role');
  }
  return {
    sub,
    id: sub,
    role,
    ...(typeof decoded.username === 'string' ? { username: decoded.username } : {}),
    ...(typeof decoded.iat === 'number' ? { iat: decoded.iat } : {}),
    ...(typeof decoded.exp === 'number' ? { exp: decoded.exp } : {}),
  };
}
