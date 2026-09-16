import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLivingArrangementDto,
  CreateLivingPatternDto,
  CancelLivingArrangementDto,
  CancelLivingPatternDto,
  SkipLivingOccurrenceDto,
} from './dto/living-arrangement.dto';
const arrangementSelect = {
  id: true,
  familyId: true,
  createdById: true,
  createdAt: true,
  currentVersion: {
    include: {
      responsibleParent: {
        select: { id: true, firstName: true, lastName: true },
      },
      children: {
        include: {
          child: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  },
  exceptions: { orderBy: { occurrenceDate: 'asc' as const } },
} satisfies Prisma.LivingArrangementSelect;
@Injectable()
export class LivingArrangementService {
  constructor(private readonly prisma: PrismaService) {}
  list(userId: string, familyId: string) {
    return this.prisma.withActor(userId, (tx) =>
      tx.livingArrangement.findMany({
        where: { familyId },
        select: arrangementSelect,
        orderBy: { createdAt: 'asc' },
      }),
    );
  }
  occurrences(userId: string, familyId: string, from: string, to: string) {
    const start = new Date(from),
      end = new Date(to);
    if (end <= start || end.getTime() - start.getTime() > 366 * 86400000)
      throw new BadRequestException(
        'Occurrence range must be between 1 and 366 days.',
      );
    return this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw`SELECT * FROM list_coparent_living_occurrences(${familyId},${start}::TIMESTAMPTZ,${end}::TIMESTAMPTZ)`,
    );
  }
  async create(
    userId: string,
    familyId: string,
    dto: CreateLivingArrangementDto,
  ) {
    this.validate(dto);
    const id = randomUUID(),
      versionId = randomUUID();
    try {
      const rows = await this.prisma.withActor(
        userId,
        (tx) =>
          tx.$queryRaw<
            Array<{ arrangementId: string | null }>
          >`SELECT create_coparent_living_arrangement(${id},${versionId},${familyId},${dto.label},${dto.frequency},${dto.dayOfWeek}::INTEGER,${dto.startMinute}::INTEGER,${dto.durationMinutes}::INTEGER,${new Date(`${dto.effectiveStart}T00:00:00Z`)}::DATE,${dto.effectiveEnd ? new Date(`${dto.effectiveEnd}T00:00:00Z`) : null}::DATE,${dto.timeZone},${dto.responsibleParentId},${dto.childIds}::TEXT[]) AS "arrangementId"`,
      );
      if (rows[0]?.arrangementId !== id) throw new NotFoundException();
    } catch (error) {
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError ||
          error instanceof Prisma.PrismaClientUnknownRequestError) &&
        String(error.message).includes('conflicts with an existing schedule')
      )
        throw new ConflictException(
          'This arrangement overlaps an existing schedule for a selected child.',
        );
      throw error;
    }
    return this.get(userId, familyId, id);
  }
  async createPattern(
    userId: string,
    familyId: string,
    dto: CreateLivingPatternDto,
  ) {
    this.validateDatesAndTimeZone(dto);
    if (new Date(`${dto.effectiveStart}T00:00:00Z`).getUTCDay() !== 1)
      throw new BadRequestException(
        'Week A must start on a Monday so the two-week rotation is unambiguous.',
      );
    this.validatePatternSegments(dto);
    const pending = dto.segments.map((segment) => ({
      segment,
      id: randomUUID(),
      versionId: randomUUID(),
    }));
    const createdIds = pending.map((item) => item.id);
    try {
      await this.prisma.withActor(userId, async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.arrangement_batch_ids', ${createdIds.join(',')}, true)`;
        for (const { segment, id, versionId } of pending) {
          const parentName = await tx.user.findUnique({
            where: { id: segment.responsibleParentId },
            select: { firstName: true, lastName: true },
          });
          const segmentLabel = `${dto.label} · ${parentName ? `${parentName.firstName} ${parentName.lastName}` : 'Parent'}`;
          const segmentStart = this.addUtcDays(
            dto.effectiveStart,
            segment.weekNumber === 2 ? 7 : 0,
          );
          const segmentEnd = dto.effectiveEnd
            ? new Date(`${dto.effectiveEnd}T00:00:00Z`)
            : null;
          const rows = await tx.$queryRaw<
            Array<{ arrangementId: string | null }>
          >`
            SELECT create_coparent_living_arrangement(
              ${id}, ${versionId}, ${familyId}, ${segmentLabel}, ${'FORTNIGHTLY'},
              ${segment.dayOfWeek}::INTEGER, ${segment.startMinute}::INTEGER,
              ${segment.durationMinutes}::INTEGER,
              ${segmentStart}::DATE, ${segmentEnd}::DATE,
              ${dto.timeZone}, ${segment.responsibleParentId}, ${segment.childIds}::TEXT[]
            ) AS "arrangementId"`;
          if (rows[0]?.arrangementId !== id) throw new NotFoundException();
        }
      });
    } catch (error) {
      this.translateConflict(error);
      throw error;
    }
    return { arrangementIds: createdIds };
  }
  async skip(
    userId: string,
    familyId: string,
    id: string,
    dto: SkipLivingOccurrenceDto,
  ) {
    const exceptionId = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<
          Array<{ exceptionId: string | null }>
        >`SELECT skip_coparent_living_occurrence(${exceptionId},${id},${familyId},${new Date(`${dto.occurrenceDate}T00:00:00Z`)}::DATE,${dto.reason}) AS "exceptionId"`,
    );
    if (rows[0]?.exceptionId !== exceptionId) throw new NotFoundException();
    return { exceptionId };
  }
  async cancel(
    userId: string,
    familyId: string,
    id: string,
    dto: CancelLivingArrangementDto,
  ) {
    const versionId = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ arrangementId: string | null }>>`
        SELECT cancel_coparent_living_arrangement(
          ${id}, ${versionId}, ${familyId}, ${dto.changeReason}
        ) AS "arrangementId"`,
    );
    if (rows[0]?.arrangementId !== id) throw new NotFoundException();
    return this.get(userId, familyId, id);
  }
  async cancelPattern(
    userId: string,
    familyId: string,
    dto: CancelLivingPatternDto,
  ) {
    await this.prisma.withActor(userId, async (tx) => {
      for (const id of dto.arrangementIds) {
        const versionId = randomUUID();
        const rows = await tx.$queryRaw<
          Array<{ arrangementId: string | null }>
        >`
          SELECT cancel_coparent_living_arrangement(
            ${id}, ${versionId}, ${familyId}, ${dto.changeReason}
          ) AS "arrangementId"`;
        if (rows[0]?.arrangementId !== id) throw new NotFoundException();
      }
    });
    return { arrangementIds: dto.arrangementIds };
  }
  private async get(userId: string, familyId: string, id: string) {
    const result = await this.prisma.withActor(userId, (tx) =>
      tx.livingArrangement.findFirst({
        where: { id, familyId },
        select: arrangementSelect,
      }),
    );
    if (!result) throw new NotFoundException();
    return result;
  }
  private validate(dto: CreateLivingArrangementDto) {
    this.validateDatesAndTimeZone(dto);
  }
  private validateDatesAndTimeZone(dto: {
    effectiveStart: string;
    effectiveEnd?: string;
    timeZone: string;
  }) {
    if (dto.effectiveEnd && dto.effectiveEnd < dto.effectiveStart)
      throw new BadRequestException(
        'Effective end must not precede the start.',
      );
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: dto.timeZone }).format(
        new Date(),
      );
    } catch {
      throw new BadRequestException('A valid IANA timezone is required.');
    }
  }
  private translateConflict(error: unknown) {
    if (
      (error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError) &&
      String(error.message).includes('conflicts with an existing schedule')
    )
      throw new ConflictException(
        'This pattern overlaps an existing active schedule. Cancel or revise the existing schedule first.',
      );
  }
  private addUtcDays(value: string, days: number) {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date;
  }
  private validatePatternSegments(dto: CreateLivingPatternDto) {
    const cycleMinutes = 14 * 24 * 60;
    const intervals = dto.segments.map((segment) => {
      const start =
        (segment.weekNumber - 1) * 7 * 24 * 60 +
        (segment.dayOfWeek - 1) * 24 * 60 +
        segment.startMinute;
      return { start, end: start + segment.durationMinutes };
    });
    for (let left = 0; left < intervals.length; left += 1) {
      for (let right = left + 1; right < intervals.length; right += 1) {
        const a = intervals[left];
        const b = intervals[right];
        if (!a || !b) continue;
        const overlaps = [-cycleMinutes, 0, cycleMinutes].some(
          (shift) => a.start < b.end + shift && a.end > b.start + shift,
        );
        if (overlaps)
          throw new ConflictException(
            'Two stays in this new pattern overlap. Adjust their start times or durations.',
          );
      }
    }
  }
}
