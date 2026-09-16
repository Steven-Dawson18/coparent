import { NotFoundException } from '@nestjs/common';
import { ChildService } from './child.service';

describe('ChildService tenancy', () => {
  it('scopes reads to both the family and authenticated membership', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const transactionClient = { child: { findFirst } };
    const prisma = {
      withActor: jest.fn(
        (
          _userId: string,
          callback: (tx: typeof transactionClient) => unknown,
        ) => callback(transactionClient),
      ),
    };
    const service = new ChildService(prisma as never);

    await expect(
      service.get('user-a', 'family-a', 'child-a'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'child-a',
        familyId: 'family-a',
        family: { memberships: { some: { userId: 'user-a' } } },
      },
    });
  });

  it('does not create a child or audit event without a writable membership', async () => {
    const childCreate = jest.fn();
    const auditCreate = jest.fn();
    const transactionClient = {
      familyMembership: { findFirst: jest.fn().mockResolvedValue(null) },
      child: { create: childCreate },
      auditEvent: { create: auditCreate },
    };
    const prisma = {
      withActor: jest.fn(
        (
          _userId: string,
          callback: (tx: typeof transactionClient) => unknown,
        ) => callback(transactionClient),
      ),
    };
    const service = new ChildService(prisma as never);

    await expect(
      service.create('attacker', 'another-family', {
        firstName: 'A',
        lastName: 'Child',
        dateOfBirth: '2020-01-01',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(childCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
