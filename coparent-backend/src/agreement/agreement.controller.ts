import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../types/authenticated-user';
import { AgreementService } from './agreement.service';
import { ListAgreementsDto } from './dto/list-agreements.dto';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@UseGuards(AuthGuard('jwt'))
@Controller('families/:familyId/agreements')
export class AgreementController {
  constructor(private readonly agreements: AgreementService) {}

  @Get()
  list(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Query() query: ListAgreementsDto,
  ) {
    return this.agreements.list(request.user.userId, familyId, query);
  }
}
