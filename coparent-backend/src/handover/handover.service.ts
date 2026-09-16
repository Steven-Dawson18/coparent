import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AcknowledgeHandoverDto,
  CancelHandoverDto,
  HandoverDto,
  ReviseHandoverDto,
} from './dto/handover.dto';
const versionSelect = {
  id: true,
  revision: true,
  state: true,
  scheduledAt: true,
  timeZone: true,
  location: true,
  notes: true,
  fromParentId: true,
  toParentId: true,
  changedById: true,
  changeReason: true,
  createdAt: true,
  fromParent: { select: { id: true, firstName: true, lastName: true } },
  toParent: { select: { id: true, firstName: true, lastName: true } },
  changedBy: { select: { id: true, firstName: true, lastName: true } },
  children: {
    include: {
      child: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  checklistItems: { orderBy: { position: 'asc' as const } },
  acknowledgements: {
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      checkedItems: true,
    },
    orderBy: { acknowledgedAt: 'asc' as const },
  },
} satisfies Prisma.HandoverVersionSelect;
const handoverSelect = {
  id: true,
  familyId: true,
  createdById: true,
  createdAt: true,
  currentVersion: { select: versionSelect },
} satisfies Prisma.HandoverSelect;
@Injectable()
export class HandoverService {
  constructor(private readonly prisma: PrismaService) {}
  list(userId: string, familyId: string, from?: string, to?: string) {
    const fromDate = from ? new Date(from) : undefined,
      toDate = to ? new Date(to) : undefined;
    return this.prisma.withActor(userId, (tx) =>
      tx.handover.findMany({
        where: {
          familyId,
          ...(fromDate &&
            toDate && {
              currentVersion: { scheduledAt: { gte: fromDate, lt: toDate } },
            }),
        },
        select: handoverSelect,
        orderBy: { currentVersion: { scheduledAt: 'asc' } },
        take: 300,
      }),
    );
  }
  history(userId: string, familyId: string, id: string) {
    return this.prisma.withActor(userId, async (tx) => {
      const item = await tx.handover.findFirst({
        where: { id, familyId },
        select: {
          versions: { select: versionSelect, orderBy: { revision: 'desc' } },
        },
      });
      if (!item) throw new NotFoundException();
      return item.versions;
    });
  }
  async create(userId: string, familyId: string, d: HandoverDto) {
    this.validate(d);
    const id = randomUUID(),
      version = randomUUID(),
      itemIds = d.checklist.map(() => randomUUID());
    const rows = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<
          Array<{ handoverId: string | null }>
        >`SELECT create_coparent_handover(${id},${version},${familyId},${new Date(d.scheduledAt)}::TIMESTAMPTZ,${d.timeZone},${d.location},${d.notes ?? null},${d.fromParentId},${d.toParentId},${d.childIds}::TEXT[],${itemIds}::TEXT[],${d.checklist}::TEXT[]) AS "handoverId"`,
    );
    if (rows[0]?.handoverId !== id) throw new NotFoundException();
    return this.get(userId, familyId, id);
  }
  async revise(
    userId: string,
    familyId: string,
    id: string,
    d: ReviseHandoverDto,
  ) {
    this.validate(d);
    const version = randomUUID(),
      itemIds = d.checklist.map(() => randomUUID());
    const rows = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<
          Array<{ handoverId: string | null }>
        >`SELECT revise_coparent_handover(${id},${version},${familyId},${new Date(d.scheduledAt)}::TIMESTAMPTZ,${d.timeZone},${d.location},${d.notes ?? null},${d.fromParentId},${d.toParentId},${d.changeReason},${d.childIds}::TEXT[],${itemIds}::TEXT[],${d.checklist}::TEXT[]) AS "handoverId"`,
    );
    if (rows[0]?.handoverId !== id) throw new NotFoundException();
    return this.get(userId, familyId, id);
  }
  async cancel(
    userId: string,
    familyId: string,
    id: string,
    d: CancelHandoverDto,
  ) {
    const version = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<
          Array<{ handoverId: string | null }>
        >`SELECT cancel_coparent_handover(${id},${version},${familyId},${d.reason}) AS "handoverId"`,
    );
    if (rows[0]?.handoverId !== id) throw new NotFoundException();
    return this.get(userId, familyId, id);
  }
  async acknowledge(
    userId: string,
    familyId: string,
    id: string,
    d: AcknowledgeHandoverDto,
  ) {
    if (d.outcome !== 'COMPLETED' && !d.note?.trim())
      throw new BadRequestException(
        'Delayed or missed handovers require an explanation.',
      );
    const ack = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<
          Array<{ handoverId: string | null }>
        >`SELECT acknowledge_coparent_handover(${id},${ack},${familyId},${d.outcome},${d.note ?? null},${d.checkedItemIds}::TEXT[]) AS "handoverId"`,
    );
    if (rows[0]?.handoverId !== id) throw new NotFoundException();
    return this.get(userId, familyId, id);
  }
  async actionCount(userId: string) {
    const count = await this.prisma.withActor(userId, (tx) =>
      tx.handover.count({
        where: {
          currentVersion: {
            state: 'SCHEDULED',
            scheduledAt: { lte: new Date(Date.now() + 7 * 86400000) },
            OR: [{ fromParentId: userId }, { toParentId: userId }],
            acknowledgements: { none: { userId } },
          },
        },
      }),
    );
    return { count };
  }
  private validate(d: HandoverDto) {
    if (d.fromParentId === d.toParentId)
      throw new BadRequestException('Handover parents must be different.');
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: d.timeZone }).format(
        new Date(d.scheduledAt),
      );
    } catch {
      throw new BadRequestException('A valid IANA timezone is required.');
    }
  }
  private async get(userId: string, familyId: string, id: string) {
    const item = await this.prisma.withActor(userId, (tx) =>
      tx.handover.findFirst({
        where: { id, familyId },
        select: handoverSelect,
      }),
    );
    if (!item) throw new NotFoundException();
    return item;
  }
}
