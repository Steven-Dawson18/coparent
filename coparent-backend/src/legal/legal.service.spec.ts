import { NotFoundException } from '@nestjs/common';
import { LegalService } from './legal.service';

function serviceWith(transactionClient: object) {
  return new LegalService(
    {
      withActor: jest.fn((_userId: string, callback: (tx: object) => unknown) =>
        callback(transactionClient),
      ),
    } as never,
    {
      createPackage: jest.fn(),
    } as never,
  );
}

describe('LegalService security transitions', () => {
  it('conceals a rejected disclosure creation', async () => {
    const service = serviceWith({
      $queryRaw: jest.fn().mockResolvedValue([{ id: null }]),
    });
    await expect(
      service.createDisclosure('parent-a', 'family-a', {
        legalCaseId: '10000000-0000-4000-8000-000000000001',
        title: 'Disclosure',
        periodFrom: '2026-01-01T00:00:00.000Z',
        periodTo: '2026-02-01T00:00:00.000Z',
        accessExpiresAt: '2027-01-01T00:00:00.000Z',
        recipientUserId: '20000000-0000-4000-8000-000000000001',
        sections: ['chronology'],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records approval only through the database transition', async () => {
    const disclosure = {
      id: '30000000-0000-4000-8000-000000000001',
      status: 'AWAITING_APPROVAL',
    };
    const queryRaw = jest.fn().mockResolvedValue([{ id: disclosure.id }]);
    const findFirst = jest.fn().mockResolvedValue(disclosure);
    const service = serviceWith({
      $queryRaw: queryRaw,
      legalDisclosure: { findFirst },
    });
    await expect(
      service.approve('parent-a', 'family-a', disclosure.id),
    ).resolves.toEqual(disclosure);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('does not generate a bundle before every required approval', async () => {
    const service = serviceWith({
      legalDisclosure: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'disclosure-a',
          status: 'AWAITING_APPROVAL',
          accessExpiresAt: new Date('2030-01-01T00:00:00Z'),
        }),
      },
    });
    await expect(
      service.bundle('parent-a', 'family-a', 'disclosure-a'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
