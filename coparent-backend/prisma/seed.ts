import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database');
  }

  const passwordHash = await bcrypt.hash('Development1!', 12);
  const owner = await prisma.user.upsert({
    where: { email: 'owner@example.test' },
    update: {},
    create: {
      firstName: 'Dev',
      lastName: 'Owner',
      email: 'owner@example.test',
      passwordHash,
    },
  });

  const existing = await prisma.familyMembership.findFirst({
    where: { userId: owner.id },
  });
  if (!existing) {
    await prisma.family.create({
      data: {
        name: 'Development family',
        memberships: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
  }
}

void main().finally(() => prisma.$disconnect());
