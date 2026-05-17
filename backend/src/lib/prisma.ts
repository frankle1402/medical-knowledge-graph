import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __mkgPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__mkgPrisma ??
  new PrismaClient({
    log: ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__mkgPrisma = prisma;
}
