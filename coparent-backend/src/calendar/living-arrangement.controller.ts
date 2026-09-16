import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../types/authenticated-user';
import { ListCalendarDto } from './dto/list-calendar.dto';
import {
  CreateLivingArrangementDto,
  CreateLivingPatternDto,
  CancelLivingArrangementDto,
  CancelLivingPatternDto,
  SkipLivingOccurrenceDto,
} from './dto/living-arrangement.dto';
import { LivingArrangementService } from './living-arrangement.service';
interface AuthenticatedRequest {
  user: AuthenticatedUser;
}
@UseGuards(AuthGuard('jwt'))
@Controller('families/:familyId/living-arrangements')
export class LivingArrangementController {
  constructor(private readonly service: LivingArrangementService) {}
  @Get() list(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
  ) {
    return this.service.list(r.user.userId, f);
  }
  @Get('occurrences') occurrences(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
    @Query() q: ListCalendarDto,
  ) {
    return this.service.occurrences(r.user.userId, f, q.from, q.to);
  }
  @Post() create(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
    @Body() d: CreateLivingArrangementDto,
  ) {
    return this.service.create(r.user.userId, f, d);
  }
  @Post('patterns') createPattern(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
    @Body() d: CreateLivingPatternDto,
  ) {
    return this.service.createPattern(r.user.userId, f, d);
  }
  @Post('patterns/cancel') cancelPattern(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
    @Body() d: CancelLivingPatternDto,
  ) {
    return this.service.cancelPattern(r.user.userId, f, d);
  }
  @Post(':arrangementId/exceptions') skip(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
    @Param('arrangementId') id: string,
    @Body() d: SkipLivingOccurrenceDto,
  ) {
    return this.service.skip(r.user.userId, f, id, d);
  }
  @Post(':arrangementId/cancel') cancel(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
    @Param('arrangementId') id: string,
    @Body() d: CancelLivingArrangementDto,
  ) {
    return this.service.cancel(r.user.userId, f, id, d);
  }
}
