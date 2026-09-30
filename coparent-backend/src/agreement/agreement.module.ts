import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AgreementController } from './agreement.controller';
import { AgreementService } from './agreement.service';

@Module({
  imports: [PrismaModule],
  controllers: [AgreementController],
  providers: [AgreementService],
})
export class AgreementModule {}
