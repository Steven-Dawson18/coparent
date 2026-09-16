import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DevelopmentEmailProvider } from './development-email.provider';
import { EmailDeliveryService } from './email-delivery.service';
import { EmailEncryptionService } from './email-encryption.service';
import { EmailOutboxService } from './email-outbox.service';
import { EmailOutboxWorker } from './email-outbox.worker';
import { ResendEmailProvider } from './resend-email.provider';
import { ResendWebhookController } from './resend-webhook.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ResendWebhookController],
  providers: [
    EmailEncryptionService,
    EmailOutboxService,
    EmailDeliveryService,
    DevelopmentEmailProvider,
    ResendEmailProvider,
    EmailOutboxWorker,
  ],
  exports: [EmailOutboxService, EmailDeliveryService],
})
export class EmailModule {}
