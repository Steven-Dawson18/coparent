import { Module } from '@nestjs/common';
import { RequestSecurityContext } from '../security/request-security-context.service';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService, RequestSecurityContext],
  exports: [PrismaService, RequestSecurityContext],
})
export class PrismaModule {}
