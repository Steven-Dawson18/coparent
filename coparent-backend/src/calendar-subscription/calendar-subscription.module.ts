import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import {
  CalendarSubscriptionController,
  PublicCalendarFeedController,
} from './calendar-subscription.controller';
import { CalendarSubscriptionService } from './calendar-subscription.service';

@Module({
  imports: [PrismaModule],
  controllers: [CalendarSubscriptionController, PublicCalendarFeedController],
  providers: [CalendarSubscriptionService],
})
export class CalendarSubscriptionModule {}
