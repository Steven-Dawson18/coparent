import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFamilyRequestDto } from './dto/create-family-request.dto';
import { ListFamilyRequestsDto } from './dto/list-family-requests.dto';
import { RespondFamilyRequestDto } from './dto/respond-family-request.dto';

const requestSelect = {
  id: true,
  familyId: true,
  createdById: true,
  respondentId: true,
  type: true,
  title: true,
  details: true,
  responseDeadlineAt: true,
  status: true,
  createdAt: true,
  resolvedAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  respondent: { select: { id: true, firstName: true, lastName: true } },
  children: {
    select: {
      child: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  attachments: {
    select: {
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
    },
  },
  responses: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      responderId: true,
      type: true,
      details: true,
      respondsToId: true,
      createdAt: true,
      responder: { select: { id: true, firstName: true, lastName: true } },
      attachments: {
        select: {
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
        },
      },
    },
  },
  agreement: {
    select: { id: true, type: true, title: true, terms: true, agreedAt: true },
  },
} satisfies Prisma.FamilyRequestSelect;

@Injectable()
export class FamilyRequestService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, familyId: string, query: ListFamilyRequestsDto) {
    return this.prisma.withActor(userId, async (tx) => {
      const requests = await tx.familyRequest.findMany({
        where: { familyId, ...(query.status && { status: query.status }) },
        select: requestSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      });
      const hasMore = requests.length > query.limit;
      const items = hasMore ? requests.slice(0, query.limit) : requests;
      return { items, nextCursor: hasMore ? items.at(-1)?.id : null };
    });
  }

  async create(userId: string, familyId: string, dto: CreateFamilyRequestDto) {
    const requestId = randomUUID();
    const deadline = dto.responseDeadlineAt
      ? new Date(dto.responseDeadlineAt)
      : null;
    const rows = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<Array<{ requestId: string | null }>>`
          SELECT create_coparent_family_request_with_attachments(
            ${requestId}, ${familyId}, ${dto.respondentId}, ${dto.type},
            ${dto.title}, ${dto.details}, ${deadline}::TIMESTAMP,
            ${dto.childIds ?? []}::TEXT[], ${dto.attachmentIds ?? []}::TEXT[]
          ) AS "requestId"
        `,
    );
    if (rows[0]?.requestId !== requestId) throw new NotFoundException();
    return this.get(userId, familyId, requestId);
  }

  async respond(
    userId: string,
    familyId: string,
    requestId: string,
    dto: RespondFamilyRequestDto,
  ) {
    const responseId = randomUUID();
    const agreementId = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<
          Array<{
            requestId: string;
            status: string;
            agreementId: string | null;
          }>
        >`
          SELECT * FROM respond_to_coparent_family_request_with_attachments(
            ${requestId}, ${responseId}, ${dto.responseType},
            ${dto.details ?? null}, ${agreementId}, ${dto.attachmentIds ?? []}::TEXT[]
          )
        `,
    );
    if (!rows[0]) throw new NotFoundException();
    return this.get(userId, familyId, requestId);
  }

  async actionRequiredCount(userId: string) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<Array<{ count: number }>>`
          SELECT count_coparent_action_required_requests() AS "count"
        `,
    );
    return { count: rows[0]?.count ?? 0 };
  }

  private async get(userId: string, familyId: string, requestId: string) {
    const request = await this.prisma.withActor(userId, (tx) =>
      tx.familyRequest.findFirst({
        where: { id: requestId, familyId },
        select: requestSelect,
      }),
    );
    if (!request) throw new NotFoundException();
    return request;
  }
}
