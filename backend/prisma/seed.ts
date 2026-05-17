import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const seeds: Array<{ username: string; email: string; role: string; password: string }> = [
    { username: 'admin', email: 'admin@example.com', role: 'admin', password: 'admin123' },
    { username: 'expert1', email: 'expert@example.com', role: 'expert', password: 'expert123' },
    { username: 'op1', email: 'op@example.com', role: 'operator', password: 'op12345' },
  ];

  for (const s of seeds) {
    const password_hash = await bcrypt.hash(s.password, 10);
    await prisma.user.upsert({
      where: { username: s.username },
      update: { email: s.email, role: s.role, is_active: true },
      create: {
        username: s.username,
        email: s.email,
        password_hash,
        role: s.role,
        is_active: true,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`seeded user ${s.username} (${s.role})`);
  }
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
