import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EvidenceExportDto, ListAuditEventsDto } from './dto/list-audit-events.dto';

const eventSelect = {
  sequence: true,
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  occurredAt: true,
  metadata: true,
  actor: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.AuditEventSelect;

type SelectedEvent = Prisma.AuditEventGetPayload<{ select: typeof eventSelect }>;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  private parseCursor(cursor?: string) {
    if (!cursor) return undefined;
    if (!/^\d+$/.test(cursor)) throw new BadRequestException('Invalid cursor.');
    return BigInt(cursor);
  }

  private dateRange(from?: string, to?: string) {
    const start = from ? new Date(from) : undefined;
    const end = to ? new Date(to) : undefined;
    if (start && end && start > end) {
      throw new BadRequestException('The start date must be before the end date.');
    }
    return start || end ? { ...(start && { gte: start }), ...(end && { lte: end }) } : undefined;
  }

  private serialize(event: SelectedEvent) {
    return { ...event, sequence: event.sequence.toString() };
  }

  async list(userId: string, familyId: string, query: ListAuditEventsDto) {
    const cursor = this.parseCursor(query.cursor);
    const occurredAt = this.dateRange(query.from, query.to);
    return this.prisma.withActor(userId, async (tx) => {
      const membership = await tx.familyMembership.findUnique({
        where: { familyId_userId: { familyId, userId } },
        select: { familyId: true },
      });
      if (!membership) throw new NotFoundException();
      const rows = await tx.auditEvent.findMany({
        where: {
          familyId,
          ...(query.action && { action: query.action }),
          ...(query.entityType && { entityType: query.entityType }),
          ...(occurredAt && { occurredAt }),
          ...(cursor && { sequence: { lt: cursor } }),
        },
        orderBy: { sequence: 'desc' },
        take: query.limit + 1,
        select: eventSelect,
      });
      const hasMore = rows.length > query.limit;
      const items = rows.slice(0, query.limit).map((event) => this.serialize(event));
      return {
        items,
        nextCursor: hasMore ? items.at(-1)?.sequence ?? null : null,
      };
    });
  }

  async export(userId: string, familyId: string, query: EvidenceExportDto) {
    const occurredAt = this.dateRange(query.from, query.to);
    return this.prisma.withActor(userId, async (tx) => {
      const membership = await tx.familyMembership.findUnique({
        where: { familyId_userId: { familyId, userId } },
        select: { role: true, family: { select: { name: true } } },
      });
      if (!membership) throw new NotFoundException();
      if (membership.role === 'PROFESSIONAL_READ_ONLY') {
        throw new ForbiddenException('Evidence export is limited to parents and family owners.');
      }
      const rows = await tx.auditEvent.findMany({
        where: {
          familyId,
          ...(query.action && { action: query.action }),
          ...(query.entityType && { entityType: query.entityType }),
          ...(occurredAt && { occurredAt }),
        },
        orderBy: { sequence: 'asc' },
        take: 5001,
        select: eventSelect,
      });
      if (rows.length > 5000) {
        throw new BadRequestException('Narrow the date range to 5,000 events or fewer.');
      }
      const events = rows.map((event) => this.serialize(event));
      const generatedAt = new Date().toISOString();
      const content = {
        format: 'coparent-evidence-v1',
        family: { id: familyId, name: membership.family.name },
        filters: {
          from: query.from ?? null,
          to: query.to ?? null,
          action: query.action ?? null,
          entityType: query.entityType ?? null,
        },
        generatedAt,
        generatedBy: userId,
        eventCount: events.length,
        events,
      };
      const canonical = JSON.stringify(content);
      return {
        ...content,
        integrity: {
          algorithm: 'SHA-256',
          checksum: createHash('sha256').update(canonical).digest('hex'),
          scope: 'UTF-8 JSON encoding of this document without the integrity property',
          notice:
            'This checksum detects changes to this export. It is not a digital signature or a statement of legal admissibility.',
        },
      };
    });
  }
}
