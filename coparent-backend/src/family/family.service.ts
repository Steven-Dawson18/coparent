import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFamilyDto } from './dto/create-family.dto';

@Injectable()
export class FamilyService {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, dto: CreateFamilyDto) {
    return this.prisma.withActor(userId, async (tx) => {
      const familyId = randomUUID();
      await tx.$executeRaw`SELECT set_config('app.creating_family_id', ${familyId}, true)`;
      const family = await tx.family.create({
        data: {
          id: familyId,
          name: dto.name.trim(),
        },
      });
      await tx.familyMembership.create({
        data: { familyId, userId, role: 'OWNER' },
      });
      await tx.auditEvent.create({
        data: {
          familyId: family.id,
          actorId: userId,
          action: 'FAMILY_CREATED',
          entityType: 'Family',
          entityId: family.id,
        },
      });
      return family;
    });
  }

  listForUser(userId: string) {
    return this.prisma.withActor(userId, (tx) =>
      tx.family.findMany({
        where: { memberships: { some: { userId } } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, createdAt: true, updatedAt: true },
      }),
    );
  }

  async getForUser(userId: string, familyId: string) {
    const family = await this.prisma.withActor(userId, (tx) =>
      tx.family.findFirst({
        where: { id: familyId, memberships: { some: { userId } } },
        select: {
          id: true,
          name: true,
          createdAt: true,
          updatedAt: true,
          memberships: {
            select: {
              role: true,
              joinedAt: true,
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      }),
    );
    if (!family) throw new NotFoundException();
    return family;
  }
}
