import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import type { UserRole } from '@mkg/shared';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const safeSelect = {
  id: true,
  username: true,
  email: true,
  role: true,
  is_active: true,
  created_at: true,
} as const;

export const usersService = {
  list() {
    return prisma.user.findMany({
      orderBy: { created_at: 'desc' },
      select: safeSelect,
    });
  },

  async create(input: {
    username: string;
    email: string;
    password: string;
    role: UserRole;
  }) {
    const existing = await prisma.user.findUnique({ where: { username: input.username } });
    if (existing) {
      throw new HttpError(409, 'USERNAME_TAKEN', 'username_taken');
    }
    const password_hash = await bcrypt.hash(input.password, 10);
    const u = await prisma.user.create({
      data: {
        username: input.username,
        email: input.email,
        password_hash,
        role: input.role,
      },
      select: safeSelect,
    });
    return {
      user_id: u.id,
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      created_at: u.created_at,
    };
  },

  async updateRole(id: string, role: UserRole) {
    try {
      const u = await prisma.user.update({
        where: { id },
        data: { role },
        select: safeSelect,
      });
      return {
        user_id: u.id,
        id: u.id,
        username: u.username,
        email: u.email,
        role: u.role,
        created_at: u.created_at,
      };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2025') {
        throw new HttpError(404, 'NOT_FOUND', 'user_not_found');
      }
      throw e;
    }
  },

  async remove(id: string, requesterId: string) {
    if (id === requesterId) {
      throw new HttpError(409, 'CANNOT_DELETE_SELF', 'cannot_delete_self');
    }
    try {
      await prisma.user.delete({ where: { id } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2025') {
        throw new HttpError(404, 'NOT_FOUND', 'user_not_found');
      }
      throw e;
    }
    return { ok: true };
  },
};
