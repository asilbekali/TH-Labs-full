import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@thlabs.dev';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!';
  const hashedPassword = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      password: hashedPassword,
      role: Role.SUPERADMIN,
    },
    create: {
      email,
      name: 'Super Admin',
      password: hashedPassword,
      role: Role.SUPERADMIN,
    },
  });

  console.log(`Seeded admin account: ${admin.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
