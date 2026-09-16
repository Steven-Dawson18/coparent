import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { ListMessagesDto } from './dto/list-messages.dto';

const messageSelect = {
  id: true,
  familyId: true,
  senderId: true,
  category: true,
  body: true,
  createdAt: true,
  sender: { select: { id: true, firstName: true, lastName: true } },
  children: {
    select: {
      child: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  receipts: {
    select: { userId: true, deliveredAt: true, readAt: true },
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
} satisfies Prisma.MessageSelect;

@Injectable()
export class MessageService {
  constructor(private readonly prisma: PrismaService) {}

  async unreadCount(userId: string) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<Array<{ count: number }>>`
          SELECT count_coparent_unread_messages() AS "count"
        `,
    );
    return { count: rows[0]?.count ?? 0 };
  }

  list(userId: string, familyId: string, query: ListMessagesDto) {
    return this.prisma.withActor(userId, async (tx) => {
      const messages = await tx.message.findMany({
        where: { familyId },
        select: messageSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      });
      const hasMore = messages.length > query.limit;
      const items = hasMore ? messages.slice(0, query.limit) : messages;
      return {
        items,
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    });
  }

  async create(userId: string, familyId: string, dto: CreateMessageDto) {
    const messageId = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<Array<{ messageId: string | null }>>`
          SELECT create_coparent_message_with_attachments(
            ${messageId}, ${familyId}, ${dto.category}, ${dto.body},
            ${dto.childIds ?? []}::TEXT[], ${dto.attachmentIds ?? []}::TEXT[]
          ) AS "messageId"
        `,
    );
    if (rows[0]?.messageId !== messageId) throw new NotFoundException();

    const message = await this.prisma.withActor(userId, (tx) =>
      tx.message.findUnique({
        where: { id: messageId },
        select: messageSelect,
      }),
    );
    if (!message) throw new NotFoundException();
    return message;
  }

  async markRead(userId: string, familyId: string, messageId: string) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<Array<{ readAt: Date | null }>>`
          SELECT mark_coparent_message_read(${messageId}, ${familyId}) AS "readAt"
        `,
    );
    if (!rows[0]?.readAt) throw new NotFoundException();
    return { messageId, readAt: rows[0].readAt };
  }
}
