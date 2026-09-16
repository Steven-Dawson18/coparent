import { Injectable, Logger } from '@nestjs/common';
import {
  EmailDeliveryProvider,
  EmailSendResult,
  InvitationEmail,
  NotificationEmail,
} from './email-delivery.provider';

@Injectable()
export class DevelopmentEmailProvider implements EmailDeliveryProvider {
  private readonly logger = new Logger(DevelopmentEmailProvider.name);

  sendInvitation(message: InvitationEmail): Promise<EmailSendResult> {
    // Never log the recipient, token, family, or child data. The local UI shows
    // the one-time secret directly to the family owner.
    this.logger.log(`Simulated invitation delivery for job ${message.jobId}`);
    return Promise.resolve({
      providerMessageId: `development-${message.jobId}`,
    });
  }
  sendNotification(message: NotificationEmail): Promise<EmailSendResult> {
    this.logger.log(`Simulated notification delivery for job ${message.jobId}`);
    return Promise.resolve({
      providerMessageId: `development-notification-${message.jobId}`,
    });
  }
}
