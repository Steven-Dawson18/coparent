import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  EmailDeliveryProvider,
  EmailSendResult,
  InvitationEmail,
  NotificationEmail,
} from './email-delivery.provider';

@Injectable()
export class ResendEmailProvider implements EmailDeliveryProvider {
  private readonly resend?: Resend;
  private readonly from?: string;
  private readonly configured: boolean;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.from = config.get<string>('EMAIL_FROM');
    this.configured = Boolean(apiKey && this.from);
    if (apiKey && this.from) this.resend = new Resend(apiKey);
  }

  async sendInvitation(message: InvitationEmail): Promise<EmailSendResult> {
    if (!this.configured || !this.from || !this.resend) {
      throw new Error('resend_delivery_failed');
    }
    const accessLabel =
      message.role === 'PARENT' ? 'parent' : 'read-only professional';
    const expires = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'long',
      timeZone: 'UTC',
    }).format(message.expiresAt);
    const { data, error } = await this.resend.emails.send(
      {
        from: this.from,
        to: [message.recipient],
        subject: 'Your CoParent invitation',
        text: [
          'You have been invited to join a CoParent family space.',
          `Access level: ${accessLabel}.`,
          `This invitation expires on ${expires}.`,
          '',
          'Sign in using this email address, open “Use invitation”, and paste this one-time code:',
          '',
          message.token,
          '',
          'If you were not expecting this invitation, you can ignore this email.',
        ].join('\n'),
        html: `<p>You have been invited to join a CoParent family space.</p>
          <p>Access level: <strong>${accessLabel}</strong>.</p>
          <p>This invitation expires on ${expires}.</p>
          <p>Sign in using this email address, open <strong>Use invitation</strong>, and paste this one-time code:</p>
          <p style="font-family:monospace;overflow-wrap:anywhere;padding:12px;background:#f3f5f4">${message.token}</p>
          <p>If you were not expecting this invitation, you can ignore this email.</p>`,
      },
      { idempotencyKey: `family-invitation/${message.jobId}` },
    );
    if (error || !data?.id) throw new Error('resend_delivery_failed');
    return { providerMessageId: data.id };
  }
  async sendNotification(message: NotificationEmail): Promise<EmailSendResult> {
    if (!this.configured || !this.from || !this.resend)
      throw new Error('resend_delivery_failed');
    const { data, error } = await this.resend.emails.send(
      {
        from: this.from,
        to: [message.recipient],
        subject: message.title,
        text: `${message.title}\n\nSign in to CoParent to view the details securely. No sensitive family content is included in notification emails.`,
        html: `<p><strong>${message.title}</strong></p><p>Sign in to CoParent to view the details securely.</p><p>No sensitive family content is included in notification emails.</p>`,
      },
      { idempotencyKey: `notification/${message.jobId}` },
    );
    if (error || !data?.id) throw new Error('resend_delivery_failed');
    return { providerMessageId: data.id };
  }
}
