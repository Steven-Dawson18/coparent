import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProfessionalAccessController, ProfessionalController } from './professional.controller';
import { ProfessionalService } from './professional.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProfessionalController, ProfessionalAccessController],
  providers: [ProfessionalService],
})
export class ProfessionalModule {}
