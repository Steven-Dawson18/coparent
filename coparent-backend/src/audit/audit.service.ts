import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EvidencePackageDto, EvidenceSection } from './dto/evidence-package.dto';
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

  async createPackage(userId: string, familyId: string, query: EvidencePackageDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (from >= to) throw new BadRequestException('The start date must be before the end date.');
    if (to.getTime() - from.getTime() > 366 * 86400000)
      throw new BadRequestException('Evidence packages are limited to a 366-day period.');
    const sections = [...new Set(query.sections)] as EvidenceSection[];
    const createdAt = { gte: from, lte: to };
    const packageId = randomUUID();

    return this.prisma.withActor(userId, async (tx) => {
      const membership = await tx.familyMembership.findUnique({
        where: { familyId_userId: { familyId, userId } },
        select: {
          role: true,
          family: {
            select: {
              id: true,
              name: true,
              children: {
                orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
                select: { id: true, firstName: true, lastName: true, dateOfBirth: true },
              },
              memberships: {
                where: { role: { in: ['OWNER', 'PARENT'] } },
                select: {
                  role: true,
                  user: { select: { id: true, firstName: true, lastName: true } },
                },
              },
            },
          },
        },
      });
      if (!membership) throw new NotFoundException();
      if (membership.role === 'PROFESSIONAL_READ_ONLY')
        throw new ForbiddenException(
          'Evidence packages are limited to parents and family owners.',
        );

      await tx.auditEvent.create({
        data: {
          id: randomUUID(),
          familyId,
          actorId: userId,
          action: 'EVIDENCE_PACKAGE_GENERATED',
          entityType: 'EvidencePackage',
          entityId: packageId,
          metadata: { from: query.from, to: query.to, sections },
        },
      });

      const enabled = (section: EvidenceSection) => sections.includes(section);
      const [
        chronologyRows,
        messages,
        requests,
        agreements,
        calendarEvents,
        livingArrangements,
        expenses,
        documents,
        handovers,
      ] = await Promise.all([
        enabled('chronology')
          ? tx.auditEvent.findMany({
              where: { familyId, occurredAt: createdAt },
              orderBy: { sequence: 'asc' },
              take: 5001,
              select: eventSelect,
            })
          : Promise.resolve([]),
        enabled('messages')
          ? tx.message.findMany({
              where: { familyId, createdAt },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              take: 2001,
              select: {
                id: true,
                category: true,
                body: true,
                createdAt: true,
                sender: { select: { id: true, firstName: true, lastName: true } },
                children: {
                  select: { child: { select: { id: true, firstName: true, lastName: true } } },
                },
                receipts: { select: { userId: true, deliveredAt: true, readAt: true } },
                attachments: { select: { documentId: true } },
              },
            })
          : Promise.resolve([]),
        enabled('requests')
          ? tx.familyRequest.findMany({
              where: {
                familyId,
                OR: [{ createdAt }, { resolvedAt: createdAt }],
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              take: 1001,
              select: {
                id: true,
                type: true,
                title: true,
                details: true,
                status: true,
                responseDeadlineAt: true,
                createdAt: true,
                resolvedAt: true,
                createdBy: { select: { id: true, firstName: true, lastName: true } },
                respondent: { select: { id: true, firstName: true, lastName: true } },
                children: { select: { childId: true } },
                attachments: { select: { documentId: true } },
                responses: {
                  orderBy: { createdAt: 'asc' },
                  select: {
                    id: true,
                    type: true,
                    details: true,
                    respondsToId: true,
                    createdAt: true,
                    responder: { select: { id: true, firstName: true, lastName: true } },
                    attachments: { select: { documentId: true } },
                  },
                },
              },
            })
          : Promise.resolve([]),
        enabled('agreements')
          ? tx.agreement.findMany({
              where: { familyId, agreedAt: createdAt },
              orderBy: [{ agreedAt: 'asc' }, { id: 'asc' }],
              take: 1001,
              select: {
                id: true,
                requestId: true,
                acceptedResponseId: true,
                type: true,
                title: true,
                terms: true,
                agreedAt: true,
              },
            })
          : Promise.resolve([]),
        enabled('calendar')
          ? tx.calendarEvent.findMany({
              where: { familyId, versions: { some: { createdAt } } },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              take: 1001,
              select: {
                id: true,
                createdAt: true,
                createdBy: { select: { id: true, firstName: true, lastName: true } },
                versions: {
                  where: { createdAt },
                  orderBy: { revision: 'asc' },
                  select: {
                    id: true,
                    revision: true,
                    category: true,
                    state: true,
                    title: true,
                    description: true,
                    startsAt: true,
                    endsAt: true,
                    timeZone: true,
                    changeReason: true,
                    createdAt: true,
                    responsibleParent: {
                      select: { id: true, firstName: true, lastName: true },
                    },
                    changedBy: { select: { id: true, firstName: true, lastName: true } },
                    children: { select: { childId: true } },
                  },
                },
              },
            })
          : Promise.resolve([]),
        enabled('calendar')
          ? tx.livingArrangement.findMany({
              where: { familyId, versions: { some: { createdAt } } },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              take: 1001,
              select: {
                id: true,
                createdAt: true,
                versions: {
                  where: { createdAt },
                  orderBy: { revision: 'asc' },
                  select: {
                    id: true,
                    revision: true,
                    state: true,
                    label: true,
                    frequency: true,
                    dayOfWeek: true,
                    startMinute: true,
                    durationMinutes: true,
                    effectiveStart: true,
                    effectiveEnd: true,
                    timeZone: true,
                    changeReason: true,
                    createdAt: true,
                    responsibleParent: {
                      select: { id: true, firstName: true, lastName: true },
                    },
                    changedBy: { select: { id: true, firstName: true, lastName: true } },
                    children: { select: { childId: true } },
                  },
                },
                exceptions: {
                  where: { createdAt },
                  orderBy: { createdAt: 'asc' },
                  select: {
                    id: true,
                    occurrenceDate: true,
                    reason: true,
                    createdAt: true,
                    createdBy: { select: { id: true, firstName: true, lastName: true } },
                  },
                },
              },
            })
          : Promise.resolve([]),
        enabled('expenses')
          ? tx.expense.findMany({
              where: { familyId, versions: { some: { createdAt } } },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              take: 1001,
              select: {
                id: true,
                createdAt: true,
                createdBy: { select: { id: true, firstName: true, lastName: true } },
                respondent: { select: { id: true, firstName: true, lastName: true } },
                versions: {
                  where: { createdAt },
                  orderBy: { revision: 'asc' },
                  select: {
                    id: true,
                    revision: true,
                    category: true,
                    title: true,
                    description: true,
                    amountMinor: true,
                    currency: true,
                    incurredOn: true,
                    changeReason: true,
                    createdAt: true,
                    paidBy: { select: { id: true, firstName: true, lastName: true } },
                    changedBy: { select: { id: true, firstName: true, lastName: true } },
                    allocations: {
                      select: { userId: true, basisPoints: true, amountMinor: true },
                    },
                    children: { select: { childId: true } },
                    response: {
                      select: {
                        id: true,
                        type: true,
                        note: true,
                        createdAt: true,
                        responder: { select: { id: true, firstName: true, lastName: true } },
                      },
                    },
                  },
                },
              },
            })
          : Promise.resolve([]),
        enabled('documents')
          ? tx.document.findMany({
              where: { familyId, versions: { some: { createdAt } } },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              take: 1001,
              select: {
                id: true,
                expenseId: true,
                createdAt: true,
                createdBy: { select: { id: true, firstName: true, lastName: true } },
                children: { select: { childId: true } },
                messageAttachment: { select: { messageId: true } },
                requestAttachment: { select: { requestId: true } },
                responseAttachment: { select: { responseId: true } },
                versions: {
                  where: { createdAt },
                  orderBy: { revision: 'asc' },
                  select: {
                    id: true,
                    revision: true,
                    category: true,
                    title: true,
                    description: true,
                    originalFileName: true,
                    mediaType: true,
                    plaintextSize: true,
                    sha256: true,
                    changeReason: true,
                    createdAt: true,
                    changedBy: { select: { id: true, firstName: true, lastName: true } },
                  },
                },
              },
            })
          : Promise.resolve([]),
        enabled('handovers')
          ? tx.handover.findMany({
              where: { familyId, versions: { some: { createdAt } } },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              take: 1001,
              select: {
                id: true,
                createdAt: true,
                versions: {
                  where: { createdAt },
                  orderBy: { revision: 'asc' },
                  select: {
                    id: true,
                    revision: true,
                    state: true,
                    scheduledAt: true,
                    timeZone: true,
                    location: true,
                    notes: true,
                    changeReason: true,
                    createdAt: true,
                    fromParent: { select: { id: true, firstName: true, lastName: true } },
                    toParent: { select: { id: true, firstName: true, lastName: true } },
                    changedBy: { select: { id: true, firstName: true, lastName: true } },
                    children: { select: { childId: true } },
                    checklistItems: {
                      orderBy: { position: 'asc' },
                      select: { id: true, label: true, position: true },
                    },
                    acknowledgements: {
                      orderBy: { acknowledgedAt: 'asc' },
                      select: {
                        id: true,
                        outcome: true,
                        note: true,
                        acknowledgedAt: true,
                        user: { select: { id: true, firstName: true, lastName: true } },
                        checkedItems: { select: { checklistItemId: true } },
                      },
                    },
                  },
                },
              },
            })
          : Promise.resolve([]),
      ]);

      const limits: Array<[string, unknown[], number]> = [
        ['chronology', chronologyRows, 5000],
        ['messages', messages, 2000],
        ['requests', requests, 1000],
        ['agreements', agreements, 1000],
        ['calendar events', calendarEvents, 1000],
        ['living arrangements', livingArrangements, 1000],
        ['expenses', expenses, 1000],
        ['documents', documents, 1000],
        ['handovers', handovers, 1000],
      ];
      for (const [name, rows, limit] of limits)
        if (rows.length > limit)
          throw new BadRequestException(
            `Narrow the date range: the package contains more than ${limit} ${name}.`,
          );

      const records: Record<string, unknown> = {};
      if (enabled('chronology'))
        records.chronology = chronologyRows.map((event) => this.serialize(event));
      if (enabled('messages')) records.messages = messages;
      if (enabled('requests')) records.requests = requests;
      if (enabled('agreements')) records.agreements = agreements;
      if (enabled('calendar'))
        records.calendar = { events: calendarEvents, livingArrangements };
      if (enabled('expenses')) records.expenses = expenses;
      if (enabled('documents')) records.documents = documents;
      if (enabled('handovers')) records.handovers = handovers;

      const content = {
        format: 'coparent-evidence-package-v2',
        packageId,
        generatedAt: new Date().toISOString(),
        generatedBy: userId,
        family: {
          id: membership.family.id,
          name: membership.family.name,
          children: membership.family.children,
          parents: membership.family.memberships.map((item) => ({
            ...item.user,
            role: item.role,
          })),
        },
        period: { from: query.from, to: query.to },
        sections,
        counts: Object.fromEntries(
          Object.entries(records).map(([name, value]) => [
            name,
            Array.isArray(value)
              ? value.length
              : Object.values(value as Record<string, unknown>).reduce<number>(
                  (total, rows) => total + (Array.isArray(rows) ? rows.length : 0),
                  0,
                ),
          ]),
        ),
        records,
        notices: [
          'Document entries contain metadata and SHA-256 file hashes, not document binaries.',
          'This package is a structured record export, not a legal opinion or guarantee of admissibility.',
        ],
      };
      const canonical = JSON.stringify(content);
      return {
        ...content,
        integrity: {
          algorithm: 'SHA-256',
          checksum: createHash('sha256').update(canonical).digest('hex'),
          scope: 'UTF-8 JSON encoding of this document without the integrity property',
          notice:
            'Recalculate the checksum after removing the integrity property to detect changes.',
        },
      };
    });
  }
}
