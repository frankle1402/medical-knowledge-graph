import { z } from 'zod';
import { User } from './user';

export const LoginInput = z.object({
  username: z.string(),
  password: z.string(),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const LoginResponse = z.object({
  token: z.string(),
  user: User,
});
export type LoginResponse = z.infer<typeof LoginResponse>;

export const JwtPayload = z.object({
  sub: z.string().uuid(),
  username: z.string(),
  role: z.string(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});
export type JwtPayload = z.infer<typeof JwtPayload>;
