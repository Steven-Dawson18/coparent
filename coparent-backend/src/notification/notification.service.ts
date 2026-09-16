import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationPreferenceDto } from './dto/notification-preference.dto';

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
          reminderLeadHours: 24,
          updatedAt: null,
        },
    );
  }

  async setPreference(userId: string, dto: NotificationPreferenceDto) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ saved: boolean }>>`
      SELECT set_coparent_notification_preference(${dto.type},${dto.inAppEnabled},${dto.emailEnabled},${dto.reminderLeadHours}::INTEGER) AS saved`,
    );
    if (!rows[0]?.saved) throw new NotFoundException();
    return this.preferences(userId);
  }
}
