import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FamilyRole, InvitationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailDeliveryService } from './email-delivery.service';
import { EmailEncryptionService } from './email-encryption.service';

interface ClaimedJob {
  jobId: string;
  invitationId: string;
  recipient: string;
  role: FamilyRole;
  invitationStatus: InvitationStatus;
  expiresAt: Date;
  ciphertext: string;
  initializationVector: string;
  authenticationTag: string;
  keyVersion: number;
  attempts: number;
}

@Injectable()
export class EmailOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailOutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly enabled: boolean;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly encryption: EmailEncryptionService,
    private readonly delivery: EmailDeliveryService,
  ) {
    this.enabled = config.get<string>('EMAIL_WORKER_ENABLED') !== 'false';
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.tick(), 5_000);
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
      const jobs = await this.prisma.$queryRaw<ClaimedJob[]>`
        SELECT * FROM claim_coparent_email_outbox(10)
      `;
      for (const job of jobs) await this.process(job);
    } catch {
      this.logger.error('Email outbox polling failed');
    } finally {
      this.running = false;
    }
  }

  private async process(job: ClaimedJob) {
    if (
      job.invitationStatus !== 'PENDING' ||
      job.expiresAt.getTime() <= Date.now()
    ) {
      await this.fail(job, 'invitation_inactive', true);
      return;
    }

    try {
      const payload = this.encryption.decrypt<{ token: string }>({
        ciphertext: job.ciphertext,
        initializationVector: job.initializationVector,
        authenticationTag: job.authenticationTag,
        keyVersion: job.keyVersion,
      });
      const result = await this.delivery.sendInvitation({
        jobId: job.jobId,
        recipient: job.recipient,
        role:
          job.role === 'PROFESSIONAL_READ_ONLY'
            ? 'PROFESSIONAL_READ_ONLY'
            : 'PARENT',
        token: payload.token,
        expiresAt: job.expiresAt,
      });
      await this.prisma.$executeRaw`
        SELECT complete_coparent_email_outbox(${job.jobId}, ${result.providerMessageId})
      `;
    } catch (error) {
      const errorCode =
        error instanceof Error && error.message === 'resend_delivery_failed'
          ? 'provider_rejected'
          : error instanceof Error &&
              error.message === 'Unsupported email outbox key version'
            ? 'unsupported_key_version'
            : 'delivery_error';
      await this.fail(
        job,
        errorCode,
        job.attempts >= 5 || errorCode === 'unsupported_key_version',
      );
    }
  }

  private async fail(job: ClaimedJob, errorCode: string, terminal: boolean) {
    const delaySeconds = Math.min(
      3_600,
      30 * 2 ** Math.max(job.attempts - 1, 0),
    );
    const retryAt = new Date(Date.now() + delaySeconds * 1_000);
    await this.prisma.$executeRaw`
      SELECT retry_coparent_email_outbox(
        ${job.jobId}, ${errorCode}, ${retryAt}, ${terminal}
      )
    `;
  }
}
