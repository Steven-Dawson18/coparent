import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CalendarEventDto,
  CancelCalendarEventDto,
  ReviseCalendarEventDto,
} from './dto/calendar-event.dto';

const versionSelect = {
  id: true,
  revision: true,
  category: true,
  state: true,
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  timeZone: true,
  responsibleParentId: true,
  changedById: true,
  changeReason: true,
  createdAt: true,
  responsibleParent: { select: { id: true, firstName: true, lastName: true } },
  changedBy: { select: { id: true, firstName: true, lastName: true } },
  children: {
    select: {
      child: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.CalendarEventVersionSelect;

const eventSelect = {
  id: true,
  familyId: true,
  createdById: true,
  createdAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  currentVersion: { select: versionSelect },
} satisfies Prisma.CalendarEventSelect;

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, familyId: string, fromValue: string, toValue: string) {
    const from = new Date(fromValue);
    const to = new Date(toValue);
    if (to <= from || to.getTime() - from.getTime() > 366 * 86400000)
      throw new BadRequestException(
        'Calendar range must be between 1 and 366 days.',
      );
    return this.prisma.withActor(userId, (tx) =>
      tx.calendarEvent.findMany({
        where: {
          familyId,
          currentVersion: { startsAt: { lt: to }, endsAt: { gt: from } },
        },
        select: eventSelect,
        orderBy: { currentVersion: { startsAt: 'asc' } },
      }),
    );
  }

  history(userId: string, familyId: string, eventId: string) {
    return this.prisma.withActor(userId, async (tx) => {
      const event = await tx.calendarEvent.findFirst({
        where: { id: eventId, familyId },
        select: {
          versions: { select: versionSelect, orderBy: { revision: 'desc' } },
        },
      });
      if (!event) throw new NotFoundException();
      return event.versions;
    });
  }

  async create(userId: string, familyId: string, dto: CalendarEventDto) {
    this.validate(dto);
    const eventId = randomUUID();
    const versionId = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ eventId: string | null }>>`
      SELECT create_coparent_calendar_event(${eventId}, ${versionId}, ${familyId}, ${dto.category}, ${dto.title},
        ${dto.description ?? null}, ${new Date(dto.startsAt)}::TIMESTAMPTZ, ${new Date(dto.endsAt)}::TIMESTAMPTZ,
        ${dto.timeZone}, ${dto.responsibleParentId ?? null}, ${dto.childIds ?? []}::TEXT[]) AS "eventId"`,
    );
    if (rows[0]?.eventId !== eventId) throw new NotFoundException();
    return this.get(userId, familyId, eventId);
  }

  async revise(
    userId: string,
    familyId: string,
    eventId: string,
    dto: ReviseCalendarEventDto,
  ) {
    this.validate(dto);
    const versionId = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ eventId: string | null }>>`
      SELECT revise_coparent_calendar_event(${eventId}, ${versionId}, ${familyId}, ${dto.category}, ${dto.title},
        ${dto.description ?? null}, ${new Date(dto.startsAt)}::TIMESTAMPTZ, ${new Date(dto.endsAt)}::TIMESTAMPTZ,
        ${dto.timeZone}, ${dto.responsibleParentId ?? null}, ${dto.changeReason}, ${dto.childIds ?? []}::TEXT[]) AS "eventId"`,
    );
    if (rows[0]?.eventId !== eventId) throw new NotFoundException();
    return this.get(userId, familyId, eventId);
  }

  async cancel(
    userId: string,
    familyId: string,
    eventId: string,
    dto: CancelCalendarEventDto,
  ) {
    const versionId = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ eventId: string | null }>>`
      SELECT cancel_coparent_calendar_event(${eventId}, ${versionId}, ${familyId}, ${dto.changeReason}) AS "eventId"`,
    );
    if (rows[0]?.eventId !== eventId) throw new NotFoundException();
    return this.get(userId, familyId, eventId);
  }

  private async get(userId: string, familyId: string, eventId: string) {
    const event = await this.prisma.withActor(userId, (tx) =>
      tx.calendarEvent.findFirst({
        where: { id: eventId, familyId },
        select: eventSelect,
      }),
    );
    if (!event) throw new NotFoundException();
    return event;
  }

  private validate(dto: CalendarEventDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt)
      throw new BadRequestException('Event end must be after its start.');
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: dto.timeZone }).format(
        startsAt,
      );
    } catch {
      throw new BadRequestException('A valid IANA timezone is required.');
    }
  }
}
