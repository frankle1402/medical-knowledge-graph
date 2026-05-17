import { z } from 'zod';
import { UserRole } from '../enums';

export const User = z.object({
  id: z.string().uuid(),
  username: z.string().min(2).max(50),
  email: z.string().email(),
  role: UserRole,
  is_active: z.boolean().default(true),
  created_at: z.string().datetime().optional(),
});
export type User = z.infer<typeof User>;

export const UserCreateInput = z.object({
  username: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  role: UserRole.default('operator'),
});
export type UserCreateInput = z.infer<typeof UserCreateInput>;
