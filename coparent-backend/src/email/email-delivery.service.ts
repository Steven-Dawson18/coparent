import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DevelopmentEmailProvider } from './development-email.provider';
import {
  EmailDeliveryProvider,
  EmailSendResult,
  InvitationEmail,
  NotificationEmail,
} from './email-delivery.provider';
import { ResendEmailProvider } from './resend-email.provider';

@Injectable()
export class EmailDeliveryService implements EmailDeliveryProvider {
  private readonly provider: EmailDeliveryProvider;
  readonly mode: 'development' | 'resend';

  constructor(
    config: ConfigService,
    development: DevelopmentEmailProvider,
    resend: ResendEmailProvider,
  ) {
    this.mode = config.getOrThrow<'development' | 'resend'>('EMAIL_PROVIDER');
    this.provider = this.mode === 'resend' ? resend : development;
  }

  sendInvitation(message: InvitationEmail): Promise<EmailSendResult> {
    return this.provider.sendInvitation(message);
  }
  sendNotification(message: NotificationEmail): Promise<EmailSendResult> {
    return this.provider.sendNotification(message);
  }

  shouldRevealLocalToken() {
    return this.mode === 'development';
  }
}
