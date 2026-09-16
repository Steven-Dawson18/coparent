import { NotFoundException } from '@nestjs/common';
import { InvitationRole } from './dto/create-invitation.dto';
import { InvitationService } from './invitation.service';

describe('InvitationService security', () => {
  it('stores only a token hash and returns the bearer secret once', async () => {
    interface CreateInput {
      data: {
        email: string;
        tokenHash: string;
        [key: string]: unknown;
      };
      select: unknown;
    }
    const create = jest.fn((input: CreateInput) => ({
      id: 'invitation-a',
      ...input.data,
      status: 'PENDING' as const,
      createdAt: new Date(),
      resolvedAt: null,
    }));
    const transactionClient = {
      familyMembership: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ familyId: 'family-a' })
          .mockResolvedValueOnce(null),
      },
      familyInvitation: {
        create,
        findFirst: jest.fn().mockResolvedValue(null),
      },
      auditEvent: { create: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const prisma = {
      withActor: jest.fn(
        (
          _userId: string,
          callback: (tx: typeof transactionClient) => unknown,
        ) => callback(transactionClient),
      ),
    };
    const outbox = { enqueueInvitation: jest.fn().mockResolvedValue('job-a') };
    const delivery = {
      shouldRevealLocalToken: jest.fn().mockReturnValue(true),
    };
    const service = new InvitationService(
      prisma as never,
      outbox as never,
      delivery as never,
    );

    const result = await service.create('owner-a', 'family-a', {
      email: ' Invited@Example.Test ',
      role: InvitationRole.PARENT,
    });

    if (!result.token) throw new Error('Expected a local invitation token');
    expect(result.token).toHaveLength(43);
    expect(create).toHaveBeenCalledTimes(1);
    const storedData = create.mock.calls[0]?.[0].data;
    expect(storedData?.email).toBe('invited@example.test');
    expect(storedData?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const storedTokenHash = storedData?.tokenHash;
    expect(storedTokenHash).not.toBe(result.token);
    expect(outbox.enqueueInvitation).toHaveBeenCalledWith(
      transactionClient,
      'invitation-a',
      result.token,
    );
  });

  it('conceals an inaccessible family and performs no invitation write', async () => {
    const invitationCreate = jest.fn();
    const auditCreate = jest.fn();
    const transactionClient = {
      familyMembership: { findFirst: jest.fn().mockResolvedValue(null) },
      familyInvitation: {
        create: invitationCreate,
        findFirst: jest.fn(),
      },
      auditEvent: { create: auditCreate },
      $executeRaw: jest.fn(),
    };
    const prisma = {
      withActor: jest.fn(
        (
          _userId: string,
          callback: (tx: typeof transactionClient) => unknown,
        ) => callback(transactionClient),
      ),
    };
    const outbox = { enqueueInvitation: jest.fn() };
    const service = new InvitationService(
      prisma as never,
      outbox as never,
      { shouldRevealLocalToken: () => true } as never,
    );

    await expect(
      service.create('outsider', 'family-a', {
        email: 'invited@example.test',
        role: InvitationRole.PARENT,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(invitationCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(outbox.enqueueInvitation).not.toHaveBeenCalled();
  });

  it('uses the same not-found response for an invalid, expired, or replayed token', async () => {
    const transactionClient = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const prisma = {
      withActor: jest.fn(
        (
          _userId: string,
          callback: (tx: typeof transactionClient) => unknown,
        ) => callback(transactionClient),
      ),
    };
    const service = new InvitationService(
      prisma as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.accept('user-a', 'invalid-invitation-token-that-is-long-enough'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
