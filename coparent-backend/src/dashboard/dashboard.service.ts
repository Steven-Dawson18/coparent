import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface LivingOccurrence {
  arrangementId: string;
  versionId: string;
  occurrenceDate: Date;
  label: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  responsibleParentId: string;
  childIds: string[];
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  summary(userId: string, familyId: string) {
    const now = new Date();
    const upcomingUntil = new Date(now.getTime() + 7 * 86400000);
    const careFrom = new Date(now.getTime() - 7 * 86400000);

    return this.prisma.withActor(userId, async (tx) => {
      const membership = await tx.familyMembership.findUnique({
        where: { familyId_userId: { familyId, userId } },
        select: { role: true },
      });
      if (!membership) throw new NotFoundException();

      const care = await tx.$queryRaw<LivingOccurrence[]>`
        SELECT * FROM list_coparent_living_occurrences(
          ${familyId}, ${careFrom}::TIMESTAMPTZ, ${upcomingUntil}::TIMESTAMPTZ
        )
        ORDER BY "startsAt" ASC
      `;
      const [children, parents, events, handovers, unreadMessages, requestActions, expenseActions] =
        await Promise.all([
          tx.child.findMany({
            where: { familyId },
            orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
            select: { id: true, firstName: true, lastName: true },
          }),
          tx.familyMembership.findMany({
            where: { familyId, role: { in: ['OWNER', 'PARENT'] } },
            select: { user: { select: { id: true, firstName: true, lastName: true } } },
          }),
          tx.calendarEvent.findMany({
            where: {
              familyId,
              currentVersion: {
                state: 'ACTIVE',
                startsAt: { gte: now, lt: upcomingUntil },
              },
            },
            orderBy: { currentVersion: { startsAt: 'asc' } },
            take: 5,
            select: {
              id: true,
              currentVersion: {
                select: {
                  title: true,
                  category: true,
                  startsAt: true,
                  endsAt: true,
                  timeZone: true,
                  children: {
                    select: { child: { select: { id: true, firstName: true, lastName: true } } },
                  },
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
            take: 5,
            select: {
              id: true,
              currentVersion: {
                select: {
                  scheduledAt: true,
                  timeZone: true,
                  location: true,
                  fromParent: { select: { id: true, firstName: true, lastName: true } },
                  toParent: { select: { id: true, firstName: true, lastName: true } },
                  children: {
                    select: { child: { select: { id: true, firstName: true, lastName: true } } },
                  },
                  acknowledgements: { where: { userId }, select: { id: true } },
                },
              },
            },
          }),
          tx.messageReceipt.count({
            where: { userId, readAt: null, message: { familyId } },
          }),
          tx.familyRequest.count({
            where: {
              familyId,
              OR: [
                { status: 'OPEN', respondentId: userId },
                { status: 'COUNTERED', createdById: userId },
              ],
              AND: [{ OR: [{ responseDeadlineAt: null }, { responseDeadlineAt: { gt: now } }] }],
            },
          }),
          tx.expense.count({
            where: { familyId, respondentId: userId, currentVersion: { response: null } },
          }),
        ]);

      const acceptedExpenses = await tx.expense.findMany({
        where: { familyId, currentVersion: { response: { type: 'ACCEPT' } } },
        select: {
          currentVersion: {
            select: {
              amountMinor: true,
              paidById: true,
              allocations: { select: { userId: true, amountMinor: true } },
            },
          },
        },
        take: 500,
      });
      const balances = new Map<string, number>();
      for (const expense of acceptedExpenses) {
        const version = expense.currentVersion;
        if (!version) continue;
        balances.set(version.paidById, (balances.get(version.paidById) ?? 0) + version.amountMinor);
        for (const allocation of version.allocations) {
          balances.set(
            allocation.userId,
            (balances.get(allocation.userId) ?? 0) - allocation.amountMinor,
          );
        }
      }

      const currentCare = care.filter((item) => item.startsAt <= now && item.endsAt > now);
      const nextCare = care.find((item) => item.startsAt > now) ?? null;
      const handoverActions = handovers.filter(
        (item) =>
          (item.currentVersion?.fromParent.id === userId ||
            item.currentVersion?.toParent.id === userId) &&
          !item.currentVersion.acknowledgements.length,
      ).length;

      return {
        generatedAt: now,
        membershipRole: membership.role,
        children,
        parents: parents.map((item) => item.user),
        care: { current: currentCare, next: nextCare },
        upcoming: { events, handovers },
        attention: {
          unreadMessages,
          requests: requestActions,
          expenses: expenseActions,
          handovers: handoverActions,
          total: unreadMessages + requestActions + expenseActions + handoverActions,
        },
        finances: {
          acceptedExpenseCount: acceptedExpenses.length,
          balances: [...balances.entries()].map(([parentId, amountMinor]) => ({
            parentId,
            amountMinor,
          })),
        },
      };
    });
  }
}
