import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationPreferenceDto } from './dto/notification-preference.dto';
import { RegisterNotificationEndpointDto } from './dto/notification-endpoint.dto';
import { randomUUID } from 'node:crypto';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.withActor(userId, (tx) =>
      tx.notification.findMany({
        select: {
          id: true,
          familyId: true,
          type: true,
          entityType: true,
          entityId: true,
          title: true,
          createdAt: true,
          readAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.withActor(userId, (tx) =>
      tx.notification.count({ where: { readAt: null } }),
    );
    return { count };
  }

  async markRead(userId: string, id: string) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ readAt: Date | null }>>`
      SELECT mark_coparent_notification_read(${id}) AS "readAt"`,
    );
    if (!rows[0]?.readAt) throw new NotFoundException();
    return { id, readAt: rows[0].readAt };
  }

  async markAllRead(userId: string) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ count: number }>>`
      SELECT mark_all_coparent_notifications_read() AS count`,
    );
    return { count: rows[0]?.count ?? 0 };
  }

  async preferences(userId: string) {
    const stored = await this.prisma.withActor(userId, (tx) =>
      tx.notificationPreference.findMany(),
    );
    const map = new Map(stored.map((item) => [item.type, item]));
    return Object.values(NotificationType).map(
      (type) =>
        map.get(type) ?? {
          userId,
          type,
          inAppEnabled: true,
          emailEnabled: true,
          pushEnabled: false,
          smsEnabled: false,
          reminderLeadHours: 24,
          updatedAt: null,
        },
    );
  }

  async setPreference(userId: string, dto: NotificationPreferenceDto) {
    if (dto.smsEnabled) {
      const verified = await this.prisma.withActor(userId, (tx) =>
        tx.notificationEndpoint.count({
          where: {
            userId,
            channel: 'SMS',
            verifiedAt: { not: null },
            revokedAt: null,
          },
        }),
      );
      if (!verified) throw new NotFoundException();
    }
    if (dto.pushEnabled) {
      const active = await this.prisma.withActor(userId, (tx) =>
        tx.notificationEndpoint.count({
          where: { userId, channel: 'PUSH', revokedAt: null },
        }),
      );
      if (!active) throw new NotFoundException();
    }
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ saved: boolean }>>`
      SELECT set_coparent_notification_channels(${dto.type},${dto.inAppEnabled},${dto.emailEnabled},${dto.pushEnabled},${dto.smsEnabled},${dto.reminderLeadHours}::INTEGER) AS saved`,
    );
    if (!rows[0]?.saved) throw new NotFoundException();
    return this.preferences(userId);
  }

  endpoints(userId: string) {
    return this.prisma.withActor(userId, async (tx) => {
      const rows = await tx.notificationEndpoint.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          channel: true,
          label: true,
          endpoint: true,
          verifiedAt: true,
          createdAt: true,
          revokedAt: true,
        },
      });
      return rows.map((row) => ({
        ...row,
        endpoint:
          row.channel === 'SMS'
            ? row.endpoint.replace(/.(?=.{4})/g, '•')
            : new URL(row.endpoint).origin,
      }));
    });
  }

  async registerEndpoint(userId: string, dto: RegisterNotificationEndpointDto) {
    if (dto.channel === 'PUSH' && (!dto.publicKey || !dto.authSecret))
      throw new NotFoundException();
    if (dto.channel === 'SMS' && !/^\+[1-9]\d{7,14}$/.test(dto.endpoint))
      throw new NotFoundException();
    const id = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ id: string | null }>>`
        SELECT register_coparent_notification_endpoint(${id},${dto.channel},${dto.label},${dto.endpoint},${dto.publicKey ?? null},${dto.authSecret ?? null}) AS id`,
    );
    if (rows[0]?.id !== id) throw new NotFoundException();
    return { id, verificationRequired: dto.channel === 'SMS' };
  }

  async revokeEndpoint(userId: string, id: string) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ id: string | null }>>`
        SELECT revoke_coparent_notification_endpoint(${id}) AS id`,
    );
    if (rows[0]?.id !== id) throw new NotFoundException();
    return { id, revoked: true };
  }
}
