import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AuthenticatedUser } from '../types/authenticated-user';
import { CalendarSubscriptionService } from './calendar-subscription.service';
import { CreateCalendarSubscriptionDto } from './dto/create-calendar-subscription.dto';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@UseGuards(AuthGuard('jwt'))
@Controller('families/:familyId/calendar-subscriptions')
export class CalendarSubscriptionController {
  constructor(private readonly subscriptions: CalendarSubscriptionService) {}

  @Get()
  list(@Request() request: AuthenticatedRequest, @Param('familyId') familyId: string) {
    return this.subscriptions.list(request.user.userId, familyId);
  }

  @Post()
  create(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Body() dto: CreateCalendarSubscriptionDto,
  ) {
    return this.subscriptions.create(request.user.userId, familyId, dto);
  }

  @Post(':subscriptionId/revoke')
  revoke(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.subscriptions.revoke(request.user.userId, familyId, subscriptionId);
  }
}

@Controller('calendar-feeds')
export class PublicCalendarFeedController {
  constructor(private readonly subscriptions: CalendarSubscriptionService) {}

  @Get(':token/calendar.ics')
  async feed(@Param('token') token: string, @Res() response: Response) {
    const calendar = await this.subscriptions.render(token);
    response.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    response.setHeader('Content-Disposition', 'inline; filename="coparent-calendar.ics"');
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.send(calendar);
  }
}
