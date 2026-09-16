import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { LivingArrangementController } from './living-arrangement.controller';
import { LivingArrangementService } from './living-arrangement.service';
@Module({
  imports: [PrismaModule],
  controllers: [CalendarController, LivingArrangementController],
  providers: [CalendarService, LivingArrangementService],
})
export class CalendarModule {}
