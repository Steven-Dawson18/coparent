/* eslint-disable @typescript-eslint/no-misused-promises */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const user1 = await prisma.user.create({
    data: {
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
      passwordHash: 'hashed-password',
    },
  });

  const user2 = await prisma.user.create({
    data: {
      firstName: 'Bob',
      lastName: 'Jones',
      email: 'bob@example.com',
      passwordHash: 'hashed-password',
    },
  });

  const group = await prisma.parentingGroup.create({
    data: {
      name: "Charlotte's Parents",
      members: {
        create: [
          { user: { connect: { id: user1.id } } },
          { user: { connect: { id: user2.id } } },
        ],
      },
    },
  });

  await prisma.message.create({
    data: {
      groupId: group.id,
      senderId: user1.id,
      recipientId: user2.id,
      content: 'Hello Bob!',
    },
  });

  console.log('Seed complete');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
