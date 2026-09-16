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
import { CreateFamilyRequestDto } from './dto/create-family-request.dto';
import { ListFamilyRequestsDto } from './dto/list-family-requests.dto';
import { RespondFamilyRequestDto } from './dto/respond-family-request.dto';
import { FamilyRequestService } from './family-request.service';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@UseGuards(AuthGuard('jwt'))
@Controller('families/:familyId/requests')
export class FamilyRequestController {
  constructor(private readonly requests: FamilyRequestService) {}

  @Get()
  list(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Query() query: ListFamilyRequestsDto,
  ) {
    return this.requests.list(request.user.userId, familyId, query);
  }

  @Post()
  create(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Body() dto: CreateFamilyRequestDto,
  ) {
    return this.requests.create(request.user.userId, familyId, dto);
  }

  @Post(':requestId/respond')
  respond(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('requestId') requestId: string,
    @Body() dto: RespondFamilyRequestDto,
  ) {
    return this.requests.respond(request.user.userId, familyId, requestId, dto);
  }
}

@UseGuards(AuthGuard('jwt'))
@Controller('requests')
export class RequestActionController {
  constructor(private readonly requests: FamilyRequestService) {}

  @Get('action-required-count')
  count(@Request() request: AuthenticatedRequest) {
    return this.requests.actionRequiredCount(request.user.userId);
  }
}
