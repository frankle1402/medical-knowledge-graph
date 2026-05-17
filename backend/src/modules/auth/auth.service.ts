import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { signToken } from '../../lib/jwt.js';
import type { UserRole } from '@mkg/shared';

export class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface LoginResult {
  token: string;
  user: {
    id: string;
    username: string;
    email: string;
    role: UserRole;
  };
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.is_active) {
    throw new AuthError(401, 'INVALID_CREDENTIALS', 'invalid_credentials');
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new AuthError(401, 'INVALID_CREDENTIALS', 'invalid_credentials');
  }
  const role = user.role as UserRole;
  const token = signToken({ sub: user.id, username: user.username, role });
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role,
    },
  };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      is_active: true,
      created_at: true,
    },
  });
  if (!user) {
    throw new AuthError(404, 'USER_NOT_FOUND', 'user_not_found');
  }
  return user;
}
