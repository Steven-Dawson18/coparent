import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [LegalController],
  providers: [LegalService],
})
export class LegalModule {}
