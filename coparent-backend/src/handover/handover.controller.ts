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
import {
  AcknowledgeHandoverDto,
  CancelHandoverDto,
  HandoverDto,
  ReviseHandoverDto,
} from './dto/handover.dto';
import { HandoverService } from './handover.service';
interface R {
  user: AuthenticatedUser;
}
@UseGuards(AuthGuard('jwt'))
@Controller('families/:familyId/handovers')
export class HandoverController {
  constructor(private readonly service: HandoverService) {}
  @Get() list(
    @Request() r: R,
    @Param('familyId') f: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.list(r.user.userId, f, from, to);
  }
  @Post() create(
    @Request() r: R,
    @Param('familyId') f: string,
    @Body() d: HandoverDto,
  ) {
    return this.service.create(r.user.userId, f, d);
  }
  @Patch(':id') revise(
    @Request() r: R,
    @Param('familyId') f: string,
    @Param('id') id: string,
    @Body() d: ReviseHandoverDto,
  ) {
    return this.service.revise(r.user.userId, f, id, d);
  }
  @Post(':id/cancel') cancel(
    @Request() r: R,
    @Param('familyId') f: string,
    @Param('id') id: string,
    @Body() d: CancelHandoverDto,
  ) {
    return this.service.cancel(r.user.userId, f, id, d);
  }
  @Post(':id/acknowledge') ack(
    @Request() r: R,
    @Param('familyId') f: string,
    @Param('id') id: string,
    @Body() d: AcknowledgeHandoverDto,
  ) {
    return this.service.acknowledge(r.user.userId, f, id, d);
  }
  @Get(':id/history') history(
    @Request() r: R,
    @Param('familyId') f: string,
    @Param('id') id: string,
  ) {
    return this.service.history(r.user.userId, f, id);
  }
}
@UseGuards(AuthGuard('jwt'))
@Controller('handovers')
export class HandoverActionController {
  constructor(private readonly service: HandoverService) {}
  @Get('action-required-count') count(@Request() r: R) {
    return this.service.actionCount(r.user.userId);
  }
}
