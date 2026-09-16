import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../types/authenticated-user';
import { CalendarService } from './calendar.service';
import {
  CalendarEventDto,
  CancelCalendarEventDto,
  ReviseCalendarEventDto,
} from './dto/calendar-event.dto';
import { ListCalendarDto } from './dto/list-calendar.dto';
interface AuthenticatedRequest {
  user: AuthenticatedUser;
}
@UseGuards(AuthGuard('jwt'))
@Controller('families/:familyId/calendar-events')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}
  @Get() list(
    @Request() req: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Query() query: ListCalendarDto,
  ) {
    return this.calendar.list(req.user.userId, familyId, query.from, query.to);
  }
  @Post() create(
    @Request() req: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Body() dto: CalendarEventDto,
  ) {
    return this.calendar.create(req.user.userId, familyId, dto);
  }
  @Patch(':eventId') revise(
    @Request() req: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('eventId') eventId: string,
    @Body() dto: ReviseCalendarEventDto,
  ) {
    return this.calendar.revise(req.user.userId, familyId, eventId, dto);
  }
  @Post(':eventId/cancel') cancel(
    @Request() req: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('eventId') eventId: string,
    @Body() dto: CancelCalendarEventDto,
  ) {
    return this.calendar.cancel(req.user.userId, familyId, eventId, dto);
  }
  @Get(':eventId/history') history(
    @Request() req: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.calendar.history(req.user.userId, familyId, eventId);
  }
}
