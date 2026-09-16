export interface InvitationEmail {
  jobId: string;
  recipient: string;
  role: 'PARENT' | 'PROFESSIONAL_READ_ONLY';
  token: string;
  expiresAt: Date;
}

export interface EmailSendResult {
  providerMessageId: string;
}
export interface NotificationEmail {
  jobId: string;
  recipient: string;
  title: string;
}

export interface EmailDeliveryProvider {
  sendInvitation(message: InvitationEmail): Promise<EmailSendResult>;
  sendNotification(message: NotificationEmail): Promise<EmailSendResult>;
}
