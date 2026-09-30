import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConfigureProfessionalAccessDto,
  RevokeProfessionalAccessDto,
} from './dto/professional-access.dto';

@Injectable()
export class ProfessionalService {
  constructor(private readonly prisma: PrismaService) {}

  listCases(userId: string) {
    return this.prisma.withActor(userId, (tx) =>
      tx.familyMembership.findMany({
        where: { userId, role: 'PROFESSIONAL_READ_ONLY' },
        orderBy: { joinedAt: 'desc' },
        select: {
          joinedAt: true,
          accessExpiresAt: true,
          family: {
            select: {
              id: true,
              name: true,
              _count: { select: { children: true } },
            },
          },
        },
      }),
    );
  }

  listAccess(userId: string, familyId: string) {
    return this.prisma.withActor(userId, async (tx) => {
      const owner = await tx.familyMembership.findFirst({
        where: { familyId, userId, role: 'OWNER', revokedAt: null },
        select: { familyId: true },
      });
      if (!owner) throw new NotFoundException();
      return tx.familyMembership.findMany({
        where: { familyId, role: 'PROFESSIONAL_READ_ONLY' },
        orderBy: { joinedAt: 'desc' },
        select: {
          userId: true,
          role: true,
          joinedAt: true,
          accessExpiresAt: true,
          revokedAt: true,
          revocationReason: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
    });
  }

  async configureAccess(
    userId: string,
    familyId: string,
    professionalUserId: string,
    dto: ConfigureProfessionalAccessDto,
  ) {
    const expiresAt = dto.accessExpiresAt ? new Date(dto.accessExpiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now() + 5 * 60_000)
      throw new NotFoundException();
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ userId: string | null }>>`
        SELECT configure_coparent_professional_access(
          ${familyId}, ${professionalUserId}, ${expiresAt}::TIMESTAMPTZ
        ) AS "userId"
      `,
    );
    if (rows[0]?.userId !== professionalUserId) throw new NotFoundException();
    return { userId: professionalUserId, accessExpiresAt: expiresAt };
  }

  async revokeAccess(
    userId: string,
    familyId: string,
    professionalUserId: string,
    dto: RevokeProfessionalAccessDto,
  ) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ userId: string | null }>>`
        SELECT revoke_coparent_professional_access(
          ${familyId}, ${professionalUserId}, ${dto.reason}
        ) AS "userId"
      `,
    );
    if (rows[0]?.userId !== professionalUserId) throw new NotFoundException();
    return { userId: professionalUserId, revoked: true };
  }

  summary(userId: string, familyId: string) {
    const now = new Date();
    const upcomingUntil = new Date(now.getTime() + 30 * 86400000);
    return this.prisma.withActor(userId, async (tx) => {
      const membership = await tx.familyMembership.findUnique({
        where: { familyId_userId: { familyId, userId } },
        select: { role: true, joinedAt: true, accessExpiresAt: true },
      });
      if (membership?.role !== 'PROFESSIONAL_READ_ONLY')
        throw new NotFoundException();

      await tx.auditEvent.create({
        data: {
          id: randomUUID(),
          familyId,
          actorId: userId,
          action: 'PROFESSIONAL_CASE_VIEWED',
          entityType: 'Family',
          entityId: familyId,
        },
      });

      const family = await tx.family.findUnique({
        where: { id: familyId },
        select: {
          id: true,
          name: true,
          children: {
            orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
            select: {
              id: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              school: true,
            },
          },
          memberships: {
            where: { role: { in: ['OWNER', 'PARENT'] } },
            orderBy: { joinedAt: 'asc' },
            select: {
              role: true,
              user: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      });
      if (!family) throw new NotFoundException();

      const [
        messages,
        requests,
        agreements,
        calendarEvents,
        expenses,
        documents,
        upcomingEvents,
        upcomingHandovers,
        recentAgreements,
        recentActivity,
      ] = await Promise.all([
        tx.message.count({ where: { familyId } }),
        tx.familyRequest.count({ where: { familyId } }),
        tx.agreement.count({ where: { familyId } }),
        tx.calendarEvent.count({ where: { familyId } }),
        tx.expense.count({ where: { familyId } }),
        tx.document.count({ where: { familyId } }),
        tx.calendarEvent.findMany({
          where: {
            familyId,
            currentVersion: {
              state: 'ACTIVE',
              startsAt: { gte: now, lt: upcomingUntil },
            },
          },
          orderBy: { currentVersion: { startsAt: 'asc' } },
          take: 10,
          select: {
            id: true,
            currentVersion: {
              select: {
                title: true,
                category: true,
                startsAt: true,
                endsAt: true,
                timeZone: true,
              },
            },
          },
        }),
        tx.handover.findMany({
          where: {
            familyId,
            currentVersion: {
              state: 'SCHEDULED',
              scheduledAt: { gte: now, lt: upcomingUntil },
            },
          },
          orderBy: { currentVersion: { scheduledAt: 'asc' } },
          take: 10,
          select: {
            id: true,
            currentVersion: {
              select: {
                scheduledAt: true,
                timeZone: true,
                location: true,
                fromParent: { select: { id: true, firstName: true, lastName: true } },
                toParent: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        }),
        tx.agreement.findMany({
          where: { familyId },
          orderBy: [{ agreedAt: 'desc' }, { id: 'desc' }],
          take: 5,
          select: { id: true, type: true, title: true, terms: true, agreedAt: true },
        }),
        tx.auditEvent.findMany({
          where: { familyId },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 20,
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            occurredAt: true,
            actor: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
      ]);

      return {
        generatedAt: now,
        access: {
          role: membership.role,
          joinedAt: membership.joinedAt,
          accessExpiresAt: membership.accessExpiresAt,
          readOnly: true,
        },
        family: {
          id: family.id,
          name: family.name,
          children: family.children,
          parents: family.memberships.map((item) => ({ ...item.user, role: item.role })),
        },
        totals: { messages, requests, agreements, calendarEvents, expenses, documents },
        upcoming: { events: upcomingEvents, handovers: upcomingHandovers },
        recentAgreements,
        recentActivity,
      };
    });
  }
}
