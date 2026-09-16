import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import {
  HandoverActionController,
  HandoverController,
} from './handover.controller';
import { HandoverService } from './handover.service';
@Module({
  imports: [PrismaModule],
  controllers: [HandoverController, HandoverActionController],
  providers: [HandoverService],
})
export class HandoverModule {}
