import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import {
  FamilyRequestController,
  RequestActionController,
} from './family-request.controller';
import { FamilyRequestService } from './family-request.service';

@Module({
  imports: [PrismaModule],
  controllers: [FamilyRequestController, RequestActionController],
  providers: [FamilyRequestService],
})
export class FamilyRequestModule {}
