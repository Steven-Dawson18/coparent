import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { InvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [InvitationController],
  providers: [InvitationService],
})
export class InvitationModule {}
