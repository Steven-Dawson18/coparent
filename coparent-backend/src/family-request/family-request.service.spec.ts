import { NotFoundException } from '@nestjs/common';
import { FamilyRequestService } from './family-request.service';

describe('FamilyRequestService security boundary', () => {
  it('rejects creation when the database transition returns no request', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ requestId: null }]),
    };
    const prisma = {
      withActor: jest.fn(
        (_actor: string, callback: (client: typeof tx) => unknown) =>
          callback(tx),
      ),
    };
    const service = new FamilyRequestService(prisma as never);

    await expect(
      service.create('professional', 'family-a', {
        respondentId: '10000000-0000-4000-8000-000000000001',
        type: 'HOLIDAY',
        title: 'Holiday',
        details: 'Proposed dates',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the actor-bound action-required count', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ count: 2 }]) };
    const prisma = {
      withActor: jest.fn(
        (_actor: string, callback: (client: typeof tx) => unknown) =>
          callback(tx),
      ),
    };
    const service = new FamilyRequestService(prisma as never);

    await expect(service.actionRequiredCount('user-a')).resolves.toEqual({
      count: 2,
    });
  });
});
