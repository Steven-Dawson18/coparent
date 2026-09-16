import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { EmailEncryptionService } from './email-encryption.service';

interface EnqueuedJob {
  jobId: string | null;
}

@Injectable()
export class EmailOutboxService {
  constructor(private readonly encryption: EmailEncryptionService) {}

  async enqueueInvitation(
    tx: Prisma.TransactionClient,
    invitationId: string,
    token: string,
  ) {
    const jobId = randomUUID();
    const encrypted = this.encryption.encrypt({ token });
    const rows = await tx.$queryRaw<EnqueuedJob[]>`
      SELECT enqueue_coparent_invitation_email(
        ${jobId}, ${invitationId}, ${encrypted.ciphertext},
        ${encrypted.initializationVector}, ${encrypted.authenticationTag},
        ${encrypted.keyVersion}::INTEGER
      ) AS "jobId"
    `;
    if (rows[0]?.jobId !== jobId) {
      throw new Error('Invitation email could not be enqueued');
    }
    return jobId;
  }
}
