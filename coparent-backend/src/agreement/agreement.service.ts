import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListAgreementsDto } from './dto/list-agreements.dto';

const attachmentSelect = {
  document: {
    select: {
      id: true,
      currentVersion: {
        select: {
          title: true,
          originalFileName: true,
          mediaType: true,
          plaintextSize: true,
          sha256: true,
        },
      },
    },
  },
} satisfies Prisma.DocumentFamilyRequestSelect;

const agreementSelect = {
  id: true,
  requestId: true,
  familyId: true,
  acceptedResponseId: true,
  type: true,
  title: true,
  terms: true,
  agreedAt: true,
  request: {
    select: {
      id: true,
      createdById: true,
      respondentId: true,
      type: true,
      title: true,
      details: true,
      responseDeadlineAt: true,
      createdAt: true,
      resolvedAt: true,
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      respondent: { select: { id: true, firstName: true, lastName: true } },
      children: {
        select: { child: { select: { id: true, firstName: true, lastName: true } } },
      },
      attachments: { select: attachmentSelect },
      responses: {
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        select: {
          id: true,
          responderId: true,
          type: true,
          details: true,
          respondsToId: true,
          createdAt: true,
          responder: { select: { id: true, firstName: true, lastName: true } },
          attachments: { select: attachmentSelect },
        },
      },
    },
  },
} satisfies Prisma.AgreementSelect;

@Injectable()
export class AgreementService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, familyId: string, query: ListAgreementsDto) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from > to) {
      throw new BadRequestException('The start date must be before the end date.');
    }
    const search = query.search?.trim();

    return this.prisma.withActor(userId, async (tx) => {
      const membership = await tx.familyMembership.findUnique({
        where: { familyId_userId: { familyId, userId } },
        select: { familyId: true },
      });
      if (!membership) throw new NotFoundException();

      const agreements = await tx.agreement.findMany({
        where: {
          familyId,
          ...(query.type && { type: query.type }),
          ...((from || to) && {
            agreedAt: { ...(from && { gte: from }), ...(to && { lte: to }) },
          }),
          ...(search && {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { terms: { contains: search, mode: 'insensitive' } },
              { request: { details: { contains: search, mode: 'insensitive' } } },
            ],
          }),
        },
        select: agreementSelect,
        orderBy: [{ agreedAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      });
      const hasMore = agreements.length > query.limit;
      const items = hasMore ? agreements.slice(0, query.limit) : agreements;
      return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
    });
  }
}
