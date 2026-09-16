import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../types/authenticated-user';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { ResolveInvitationDto } from './dto/resolve-invitation.dto';
import { InvitationService } from './invitation.service';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@UseGuards(AuthGuard('jwt'))
@Controller()
export class InvitationController {
  constructor(private readonly invitations: InvitationService) {}

  @Post('families/:familyId/invitations')
  create(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitations.create(request.user.userId, familyId, dto);
  }

  @Get('families/:familyId/invitations')
  list(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
  ) {
    return this.invitations.list(request.user.userId, familyId);
  }

  @Post('families/:familyId/invitations/:invitationId/revoke')
  revoke(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitations.revoke(request.user.userId, familyId, invitationId);
  }

  @Post('families/:familyId/invitations/:invitationId/resend')
  resend(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitations.resend(request.user.userId, familyId, invitationId);
  }

  @Post('invitations/accept')
  accept(
    @Request() request: AuthenticatedRequest,
    @Body() dto: ResolveInvitationDto,
  ) {
    return this.invitations.accept(request.user.userId, dto.token);
  }

  @Post('invitations/decline')
  decline(
    @Request() request: AuthenticatedRequest,
    @Body() dto: ResolveInvitationDto,
  ) {
    return this.invitations.decline(request.user.userId, dto.token);
  }
}
