import { NotFoundException } from '@nestjs/common';
import { ProfessionalService } from './professional.service';

describe('ProfessionalService', () => {
  function serviceWith(tx: object) {
    return new ProfessionalService({
      withActor: jest.fn((_userId: string, callback: (value: object) => unknown) => callback(tx)),
    } as never);
  }

  it('lists only read-only professional memberships', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await serviceWith({ familyMembership: { findMany } }).listCases('professional-a');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'professional-a', role: 'PROFESSIONAL_READ_ONLY' },
      }),
    );
  });

  it('conceals summaries from parents and unrelated accounts', async () => {
    const service = serviceWith({
      familyMembership: { findUnique: jest.fn().mockResolvedValue({ role: 'PARENT' }) },
    });
    await expect(service.summary('parent-a', 'family-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('changes professional expiry only when the database transition succeeds', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ userId: 'professional-a' }]);
    const result = await serviceWith({ $queryRaw: queryRaw }).configureAccess(
      'owner-a',
      'family-a',
      'professional-a',
      { accessExpiresAt: '2030-01-01T12:00:00.000Z' },
    );
    expect(result).toEqual({
      userId: 'professional-a',
      accessExpiresAt: new Date('2030-01-01T12:00:00.000Z'),
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('conceals a rejected professional revocation', async () => {
    const service = serviceWith({ $queryRaw: jest.fn().mockResolvedValue([{ userId: null }]) });
    await expect(
      service.revokeAccess('parent-a', 'family-a', 'professional-a', {
        reason: 'Access is no longer required.',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns a bounded read-only case overview', async () => {
    const tx = {
      familyMembership: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'PROFESSIONAL_READ_ONLY',
          joinedAt: new Date('2026-09-01T00:00:00Z'),
        }),
      },
      family: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'family-a',
          name: 'Example family',
          children: [{ id: 'child-a', firstName: 'Casey', lastName: 'Example' }],
          memberships: [
            {
              role: 'OWNER',
              user: { id: 'parent-a', firstName: 'Alex', lastName: 'Example' },
            },
          ],
        }),
      },
      message: { count: jest.fn().mockResolvedValue(4) },
      familyRequest: { count: jest.fn().mockResolvedValue(3) },
      agreement: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([]),
      },
      calendarEvent: {
        count: jest.fn().mockResolvedValue(5),
        findMany: jest.fn().mockResolvedValue([]),
      },
      expense: { count: jest.fn().mockResolvedValue(6) },
      document: { count: jest.fn().mockResolvedValue(7) },
      handover: { findMany: jest.fn().mockResolvedValue([]) },
      auditEvent: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const result = await serviceWith(tx).summary('professional-a', 'family-a');
    expect(result.access).toEqual(
      expect.objectContaining({ role: 'PROFESSIONAL_READ_ONLY', readOnly: true }),
    );
    expect(result.totals).toEqual({
      messages: 4,
      requests: 3,
      agreements: 2,
      calendarEvents: 5,
      expenses: 6,
      documents: 7,
    });
    expect(tx.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        familyId: 'family-a',
        actorId: 'professional-a',
        action: 'PROFESSIONAL_CASE_VIEWED',
      }),
    });
  });
});
