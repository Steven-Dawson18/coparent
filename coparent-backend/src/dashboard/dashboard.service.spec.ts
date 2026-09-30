import { NotFoundException } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  function serviceWith(tx: object) {
    return new DashboardService({
      withActor: jest.fn((_userId: string, callback: (value: object) => unknown) => callback(tx)),
    } as never);
  }

  it('conceals a dashboard when the actor is not a family member', async () => {
    const service = serviceWith({
      familyMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.summary('user-a', 'family-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('summarises care, family-specific actions, and accepted balances', async () => {
    const now = Date.now();
    const tx = {
      familyMembership: {
        findUnique: jest.fn().mockResolvedValue({ role: 'PARENT' }),
        findMany: jest.fn().mockResolvedValue([
          { user: { id: 'user-a', firstName: 'Alex', lastName: 'Parent' } },
          { user: { id: 'user-b', firstName: 'Blair', lastName: 'Parent' } },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          arrangementId: 'arrangement-a',
          versionId: 'version-a',
          occurrenceDate: new Date(),
          label: 'With Alex',
          startsAt: new Date(now - 3600000),
          endsAt: new Date(now + 3600000),
          timeZone: 'Europe/London',
          responsibleParentId: 'user-a',
          childIds: ['child-a'],
        },
      ]),
      child: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'child-a', firstName: 'Casey', lastName: 'Parent' }]),
      },
      calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
      handover: { findMany: jest.fn().mockResolvedValue([]) },
      messageReceipt: { count: jest.fn().mockResolvedValue(2) },
      familyRequest: { count: jest.fn().mockResolvedValue(1) },
      expense: {
        count: jest.fn().mockResolvedValue(3),
        findMany: jest.fn().mockResolvedValue([
          {
            currentVersion: {
              amountMinor: 10000,
              paidById: 'user-a',
              allocations: [
                { userId: 'user-a', amountMinor: 5000 },
                { userId: 'user-b', amountMinor: 5000 },
              ],
            },
          },
        ]),
      },
    };
    const summary = await serviceWith(tx).summary('user-a', 'family-a');
    expect(summary.attention).toEqual({
      unreadMessages: 2,
      requests: 1,
      expenses: 3,
      handovers: 0,
      total: 6,
    });
    expect(summary.care.current).toHaveLength(1);
    expect(summary.finances.balances).toEqual([
      { parentId: 'user-a', amountMinor: 5000 },
      { parentId: 'user-b', amountMinor: -5000 },
    ]);
  });
});
