import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AgreementService } from './agreement.service';

describe('AgreementService', () => {
  function serviceWith(tx: object) {
    return new AgreementService({
      withActor: jest.fn((_userId: string, callback: (value: object) => unknown) => callback(tx)),
    } as never);
  }

  it('rejects an inverted agreement date range', () => {
    const service = serviceWith({});
    expect(() =>
      service.list('user-a', 'family-a', {
        from: '2026-09-20T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
        limit: 30,
      }),
    ).toThrow(BadRequestException);
  });

  it('conceals agreement history from a non-member', async () => {
    const service = serviceWith({
      familyMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      service.list('user-a', 'family-a', { limit: 30 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns a stable page and applies family, type, and text filters', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'agreement-a', agreedAt: new Date('2026-09-10T10:00:00Z') },
      { id: 'agreement-b', agreedAt: new Date('2026-09-09T10:00:00Z') },
    ]);
    const service = serviceWith({
      familyMembership: { findUnique: jest.fn().mockResolvedValue({ familyId: 'family-a' }) },
      agreement: { findMany },
    });
    await expect(
      service.list('user-a', 'family-a', {
        search: '  school trip  ',
        type: 'SCHOOL',
        limit: 1,
      }),
    ).resolves.toEqual({
      items: [{ id: 'agreement-a', agreedAt: new Date('2026-09-10T10:00:00Z') }],
      nextCursor: 'agreement-a',
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          familyId: 'family-a',
          type: 'SCHOOL',
          OR: expect.arrayContaining([
            { title: { contains: 'school trip', mode: 'insensitive' } },
          ]),
        }),
        take: 2,
      }),
    );
  });
});
