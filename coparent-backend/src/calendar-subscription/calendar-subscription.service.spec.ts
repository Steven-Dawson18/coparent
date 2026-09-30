import { NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CalendarSubscriptionService } from './calendar-subscription.service';

describe('CalendarSubscriptionService', () => {
  it('stores only a token digest and returns the raw secret once', async () => {
    const create = jest.fn().mockImplementation(({ data }) => ({
      id: data.id,
      familyId: data.familyId,
      label: data.label,
      createdAt: new Date(),
      revokedAt: null,
      lastAccessedAt: null,
      createdBy: { id: data.createdById, firstName: 'Alex', lastName: 'Parent' },
    }));
    const tx = {
      familyMembership: { findUnique: jest.fn().mockResolvedValue({ role: 'PARENT' }) },
      calendarSubscription: { create },
      auditEvent: { create: jest.fn() },
    };
    const service = new CalendarSubscriptionService({
      withActor: jest.fn((_userId, callback) => callback(tx)),
    } as never);
    const result = await service.create('user-a', 'family-a', { label: ' Phone ' });
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = create.mock.calls[0][0].data;
    expect(stored.label).toBe('Phone');
    expect(stored.tokenHash).toBe(createHash('sha256').update(result.token).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(result.token);
  });

  it('conceals malformed and unknown feed tokens', async () => {
    const service = new CalendarSubscriptionService({
      $transaction: jest.fn(),
    } as never);
    await expect(service.render('not-a-token')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('renders a standards-based, privacy-minimal calendar', async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { familyId: 'family-a', familyName: 'Example Family', createdById: 'user-a' },
        ])
        .mockResolvedValueOnce([]),
      calendarEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'event-a',
            currentVersion: {
              title: 'School, meeting',
              startsAt: new Date('2026-10-01T09:00:00Z'),
              endsAt: new Date('2026-10-01T10:00:00Z'),
            },
          },
        ]),
      },
      handover: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new CalendarSubscriptionService({
      $transaction: jest.fn((callback) => callback(tx)),
    } as never);
    const calendar = await service.render('a'.repeat(43));
    expect(calendar).toContain('BEGIN:VCALENDAR\r\n');
    expect(calendar).toContain('SUMMARY:School\\, meeting');
    expect(calendar).toContain('DTSTART:20261001T090000Z');
    expect(calendar).not.toContain('DESCRIPTION:');
    expect(calendar.endsWith('\r\n')).toBe(true);
  });

  it('maps failed revocation to the same not-found boundary', async () => {
    const service = new CalendarSubscriptionService({
      withActor: jest.fn((_userId, callback) => callback({ $queryRaw: jest.fn().mockResolvedValue([]) })),
    } as never);
    await expect(service.revoke('user-a', 'family-a', 'feed-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
