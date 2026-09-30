import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../types/authenticated-user';
import { ProfessionalService } from './professional.service';
import {
  ConfigureProfessionalAccessDto,
  RevokeProfessionalAccessDto,
} from './dto/professional-access.dto';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@UseGuards(AuthGuard('jwt'))
@Controller('families/:familyId/professional-access')
export class ProfessionalAccessController {
  constructor(private readonly professional: ProfessionalService) {}

  @Get()
  list(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
  ) {
    return this.professional.listAccess(request.user.userId, familyId);
  }

  @Patch(':userId')
  configure(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('userId') userId: string,
    @Body() dto: ConfigureProfessionalAccessDto,
  ) {
    return this.professional.configureAccess(request.user.userId, familyId, userId, dto);
  }

  @Post(':userId/revoke')
  revoke(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('userId') userId: string,
    @Body() dto: RevokeProfessionalAccessDto,
  ) {
    return this.professional.revokeAccess(request.user.userId, familyId, userId, dto);
  }
}

@UseGuards(AuthGuard('jwt'))
@Controller('professional/cases')
export class ProfessionalController {
  constructor(private readonly professional: ProfessionalService) {}

  @Get()
  list(@Request() request: AuthenticatedRequest) {
    return this.professional.listCases(request.user.userId);
  }

  @Get(':familyId/summary')
  summary(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
  ) {
    return this.professional.summary(request.user.userId, familyId);
  }
}
