import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCalendarSubscriptionDto } from './dto/create-calendar-subscription.dto';

interface ResolvedFeed {
  familyId: string;
  familyName: string;
  createdById: string;
}

interface LivingOccurrence {
  arrangementId: string;
  occurrenceDate: Date;
  label: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
}

interface FeedItem {
  uid: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location?: string;
}

@Injectable()
export class CalendarSubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, familyId: string) {
    return this.prisma.withActor(userId, (tx) =>
      tx.calendarSubscription.findMany({
        where: { familyId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          familyId: true,
          label: true,
          createdAt: true,
          revokedAt: true,
          lastAccessedAt: true,
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    );
  }

  create(userId: string, familyId: string, dto: CreateCalendarSubscriptionDto) {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(token);
    return this.prisma.withActor(userId, async (tx) => {
      const membership = await tx.familyMembership.findUnique({
        where: { familyId_userId: { familyId, userId } },
        select: { role: true },
      });
      if (!membership || membership.role === 'PROFESSIONAL_READ_ONLY') {
        throw new NotFoundException();
      }
      const subscription = await tx.calendarSubscription.create({
        data: { id, familyId, createdById: userId, label: dto.label.trim(), tokenHash },
        select: {
          id: true,
          familyId: true,
          label: true,
          createdAt: true,
          revokedAt: true,
          lastAccessedAt: true,
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      await tx.auditEvent.create({
        data: {
          familyId,
          actorId: userId,
          action: 'CALENDAR_SUBSCRIPTION_CREATED',
          entityType: 'CalendarSubscription',
          entityId: id,
        },
      });
      return {
        ...subscription,
        token,
        feedPath: `/calendar-feeds/${token}/calendar.ics`,
      };
    });
  }

  async revoke(userId: string, familyId: string, subscriptionId: string) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ subscriptionId: string | null }>>`
        SELECT revoke_coparent_calendar_subscription(
          ${subscriptionId}, ${familyId}
        ) AS "subscriptionId"
      `,
    );
    if (rows[0]?.subscriptionId !== subscriptionId) throw new NotFoundException();
    return { id: subscriptionId, revoked: true };
  }

  async render(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundException();
    const tokenHash = this.hash(token);
    return this.prisma.$transaction(async (tx) => {
      const resolved = await tx.$queryRaw<ResolvedFeed[]>`
        SELECT * FROM resolve_coparent_calendar_subscription(${tokenHash})
      `;
      const feed = resolved[0];
      if (!feed) throw new NotFoundException();

      const from = new Date(Date.now() - 30 * 86400000);
      const to = new Date(Date.now() + 366 * 86400000);
      const [calendarEvents, handovers, livingOccurrences] = await Promise.all([
        tx.calendarEvent.findMany({
          where: {
            familyId: feed.familyId,
            currentVersion: {
              state: 'ACTIVE',
              startsAt: { lt: to },
              endsAt: { gt: from },
            },
          },
          take: 2000,
          select: {
            id: true,
            currentVersion: { select: { title: true, startsAt: true, endsAt: true } },
          },
        }),
        tx.handover.findMany({
          where: {
            familyId: feed.familyId,
            currentVersion: { state: 'SCHEDULED', scheduledAt: { gte: from, lt: to } },
          },
          take: 2000,
          select: {
            id: true,
            currentVersion: {
              select: {
                scheduledAt: true,
                location: true,
                fromParent: { select: { firstName: true } },
                toParent: { select: { firstName: true } },
              },
            },
          },
        }),
        tx.$queryRaw<LivingOccurrence[]>`
          SELECT "arrangementId", "occurrenceDate", "label", "startsAt", "endsAt", "timeZone"
          FROM list_coparent_living_occurrences(
            ${feed.familyId}, ${from}::TIMESTAMPTZ, ${to}::TIMESTAMPTZ
          )
          ORDER BY "startsAt" ASC
          LIMIT 2000
        `,
      ]);

      const items: FeedItem[] = [
        ...calendarEvents.flatMap((event) =>
          event.currentVersion
            ? [{
                uid: `event-${event.id}@coparent`,
                title: event.currentVersion.title,
                startsAt: event.currentVersion.startsAt,
                endsAt: event.currentVersion.endsAt,
              }]
            : [],
        ),
        ...handovers.flatMap((handover) =>
          handover.currentVersion
            ? [{
                uid: `handover-${handover.id}@coparent`,
                title: `Handover: ${handover.currentVersion.fromParent.firstName} to ${handover.currentVersion.toParent.firstName}`,
                startsAt: handover.currentVersion.scheduledAt,
                endsAt: new Date(handover.currentVersion.scheduledAt.getTime() + 30 * 60000),
                location: handover.currentVersion.location,
              }]
            : [],
        ),
        ...livingOccurrences.map((occurrence) => ({
          uid: `living-${occurrence.arrangementId}-${this.dateOnly(occurrence.occurrenceDate)}@coparent`,
          title: occurrence.label,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
        })),
      ].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());

      return this.toIcalendar(feed.familyName, items);
    });
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private dateOnly(value: Date) {
    return value.toISOString().slice(0, 10).replace(/-/g, '');
  }

  private utc(value: Date) {
    return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  private escape(value: string) {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\r?\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  private fold(line: string) {
    const lines: string[] = [];
    let current = '';
    for (const character of line) {
      if (Buffer.byteLength(current + character, 'utf8') > 75) {
        lines.push(current);
        current = ` ${character}`;
      } else {
        current += character;
      }
    }
    lines.push(current);
    return lines.join('\r\n');
  }

  private toIcalendar(familyName: string, items: FeedItem[]) {
    const generatedAt = this.utc(new Date());
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CoParent//Shared Family Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${this.escape(`CoParent — ${familyName}`)}`,
      'X-PUBLISHED-TTL:PT1H',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      ...items.flatMap((item) => [
        'BEGIN:VEVENT',
        `UID:${item.uid}`,
        `DTSTAMP:${generatedAt}`,
        `DTSTART:${this.utc(item.startsAt)}`,
        `DTEND:${this.utc(item.endsAt)}`,
        `SUMMARY:${this.escape(item.title)}`,
        ...(item.location ? [`LOCATION:${this.escape(item.location)}`] : []),
        'END:VEVENT',
      ]),
      'END:VCALENDAR',
    ];
    return `${lines.map((line) => this.fold(line)).join('\r\n')}\r\n`;
  }
}
