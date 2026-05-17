import { describe, it, expect } from 'vitest';
import { prisma } from '../prisma';

describe('prisma client', () => {
  it('can query users table without throwing', async () => {
    const all = await prisma.user.findMany();
    expect(Array.isArray(all)).toBe(true);
  });

  it('exposes the same singleton', async () => {
    const mod = await import('../prisma');
    expect(mod.prisma).toBe(prisma);
  });
});
