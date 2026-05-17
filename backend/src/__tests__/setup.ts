import { beforeEach, afterAll } from 'vitest';
import { prisma } from '../lib/prisma';

// Each test file starts with a clean slate, except for migration metadata.
// Order matters: child tables before parent.
beforeEach(async () => {
  await prisma.aiGenerationLog.deleteMany();
  await prisma.promptTemplate.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
