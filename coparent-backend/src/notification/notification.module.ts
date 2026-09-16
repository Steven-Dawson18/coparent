import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationWorker } from './notification.worker';
@Module({
  imports: [EmailModule, PrismaModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationWorker],
})
export class NotificationModule {}
