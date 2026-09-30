import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditService } from './audit.service';

const event = {
  sequence: 42n,
  id: 'event-id',
  action: 'MESSAGE_SENT',
  entityType: 'Message',
  entityId: 'message-id',
  occurredAt: new Date('2026-09-16T10:00:00.000Z'),
  metadata: null,
  actor: { id: 'user-id', firstName: 'Alex', lastName: 'Parent' },
};

describe('AuditService', () => {
  function serviceWith(tx: object) {
    const prisma = {
      withActor: jest.fn((_userId: string, callback: (value: object) => unknown) => callback(tx)),
    };
    return new AuditService(prisma as never);
  }

  it('conceals a family when the actor has no membership', async () => {
    const service = serviceWith({
      familyMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.list('user-id', 'family-id', { limit: 50 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns opaque string cursors instead of JSON-unsafe bigint values', async () => {
    const service = serviceWith({
      familyMembership: { findUnique: jest.fn().mockResolvedValue({ familyId: 'family-id' }) },
      auditEvent: { findMany: jest.fn().mockResolvedValue([event]) },
    });
    await expect(service.list('user-id', 'family-id', { limit: 50 })).resolves.toMatchObject({
      items: [{ sequence: '42', action: 'MESSAGE_SENT' }],
      nextCursor: null,
    });
  });

  it('does not allow read-only professionals to download evidence', async () => {
    const service = serviceWith({
      familyMembership: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'PROFESSIONAL_READ_ONLY',
          family: { name: 'Family' },
        }),
      },
    });
    await expect(service.export('user-id', 'family-id', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('generates a reproducible checksum over the export content', async () => {
    const service = serviceWith({
      familyMembership: {
        findUnique: jest.fn().mockResolvedValue({ role: 'PARENT', family: { name: 'Family' } }),
      },
      auditEvent: { findMany: jest.fn().mockResolvedValue([event]) },
    });
    const result = await service.export('user-id', 'family-id', {});
    const { integrity, ...content } = result;
    expect(integrity.checksum).toBe(
      createHash('sha256').update(JSON.stringify(content)).digest('hex'),
    );
    expect(content.events[0].sequence).toBe('42');
  });
});
