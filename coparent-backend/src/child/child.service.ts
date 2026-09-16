import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, FamilyRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

const writeRoles: FamilyRole[] = ['OWNER', 'PARENT'];

@Injectable()
export class ChildService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, familyId: string) {
    return this.prisma.withActor(userId, (tx) =>
      tx.child.findMany({
        where: { familyId, family: { memberships: { some: { userId } } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async get(userId: string, familyId: string, childId: string) {
    const child = await this.prisma.withActor(userId, (tx) =>
      tx.child.findFirst({
        where: {
          id: childId,
          familyId,
          family: { memberships: { some: { userId } } },
        },
      }),
    );
    if (!child) throw new NotFoundException();
    return child;
  }

  create(userId: string, familyId: string, dto: CreateChildDto) {
    return this.prisma.withActor(userId, async (tx) => {
      await this.requireWriteMembership(tx, userId, familyId);
      const child = await tx.child.create({
        data: {
          familyId,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          dateOfBirth: new Date(dto.dateOfBirth),
          school: dto.school?.trim(),
        },
      });
      await tx.auditEvent.create({
        data: {
          familyId,
          actorId: userId,
          action: 'CHILD_CREATED',
          entityType: 'Child',
          entityId: child.id,
        },
      });
      return child;
    });
  }

  update(
    userId: string,
    familyId: string,
    childId: string,
    dto: UpdateChildDto,
  ) {
    return this.prisma.withActor(userId, async (tx) => {
      await this.requireWriteMembership(tx, userId, familyId);
      const existing = await tx.child.findFirst({
        where: { id: childId, familyId },
      });
      if (!existing) throw new NotFoundException();

      const child = await tx.child.update({
        where: { id: childId },
        data: {
          ...(dto.firstName && { firstName: dto.firstName.trim() }),
          ...(dto.lastName && { lastName: dto.lastName.trim() }),
          ...(dto.dateOfBirth && { dateOfBirth: new Date(dto.dateOfBirth) }),
          ...(dto.school !== undefined && { school: dto.school.trim() }),
        },
      });
      await tx.auditEvent.create({
        data: {
          familyId,
          actorId: userId,
          action: 'CHILD_UPDATED',
          entityType: 'Child',
          entityId: child.id,
          metadata: { changedFields: Object.keys(dto) },
        },
      });
      return child;
    });
  }

  private async requireWriteMembership(
    tx: Prisma.TransactionClient,
    userId: string,
    familyId: string,
  ) {
    const membership = await tx.familyMembership.findFirst({
      where: { userId, familyId, role: { in: writeRoles } },
      select: { familyId: true },
    });
    if (!membership) throw new NotFoundException();
  }
}
