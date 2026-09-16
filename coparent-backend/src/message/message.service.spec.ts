import { NotFoundException } from '@nestjs/common';
import { MessageService } from './message.service';

describe('MessageService security boundary', () => {
  it('gets the unread count through an actor-bound database function', async () => {
    const transactionClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ count: 3 }]),
    };
    const prisma = {
      withActor: jest.fn(
        (
          _userId: string,
          callback: (tx: typeof transactionClient) => unknown,
        ) => callback(transactionClient),
      ),
    };
    const service = new MessageService(prisma as never);

    await expect(service.unreadCount('user-a')).resolves.toEqual({ count: 3 });
    expect(prisma.withActor).toHaveBeenCalledWith(
      'user-a',
      expect.any(Function),
    );
  });

  it('does not return a message when the database send function rejects it', async () => {
    const transactionClient = {
      $queryRaw: jest.fn().mockResolvedValue([{ messageId: null }]),
    };
    const prisma = {
      withActor: jest.fn(
        (
          _userId: string,
          callback: (tx: typeof transactionClient) => unknown,
        ) => callback(transactionClient),
      ),
    };
    const service = new MessageService(prisma as never);

    await expect(
      service.create('professional', 'family-a', {
        body: 'Not permitted',
        category: 'GENERAL',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uses bounded cursor pagination in reverse chronological order', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const transactionClient = { message: { findMany } };
    const prisma = {
      withActor: jest.fn(
        (
          _userId: string,
          callback: (tx: typeof transactionClient) => unknown,
        ) => callback(transactionClient),
      ),
    };
    const service = new MessageService(prisma as never);

    await expect(
      service.list('user-a', 'family-a', { limit: 20 }),
    ).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { familyId: 'family-a' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
      }),
    );
  });
});
