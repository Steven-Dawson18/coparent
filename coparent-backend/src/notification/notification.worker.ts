import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailDeliveryService } from '../email/email-delivery.service';

interface Job {
  jobId: string;
  notificationId: string;
  recipient: string;
  title: string;
  type: string;
  attempts: number;
}
@Injectable()
export class NotificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly enabled: boolean;
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly email: EmailDeliveryService,
  ) {
    this.enabled =
      config.get<string>('NOTIFICATION_WORKER_ENABLED') !== 'false';
  }
  onModuleInit() {
    if (!this.enabled) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref();
    void this.tick();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.prisma.$executeRaw`SELECT enqueue_coparent_due_reminders()`;
      const jobs = await this.prisma.$queryRaw<
        Job[]
      >`SELECT * FROM claim_coparent_notification_email_outbox(10)`;
      for (const job of jobs) await this.process(job);
    } catch {
      this.logger.error('Notification polling failed');
    } finally {
      this.running = false;
    }
  }
  private async process(job: Job) {
    try {
      const result = await this.email.sendNotification({
        jobId: job.jobId,
        recipient: job.recipient,
        title: job.title,
      });
      await this.prisma
        .$executeRaw`SELECT complete_coparent_notification_email(${job.jobId},${result.providerMessageId})`;
    } catch {
      const terminal = job.attempts >= 5;
      const retryAt = new Date(
        Date.now() +
          Math.min(3600, 30 * 2 ** Math.max(job.attempts - 1, 0)) * 1000,
      );
      await this.prisma
        .$executeRaw`SELECT retry_coparent_notification_email(${job.jobId},${'delivery_error'},${retryAt},${terminal})`;
    }
  }
}
