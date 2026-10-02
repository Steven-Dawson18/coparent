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
import {
  CreateLegalCaseDto,
  CreateLegalDisclosureDto,
  RevokeLegalDisclosureDto,
} from './dto/legal.dto';
import { LegalService } from './legal.service';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@UseGuards(AuthGuard('jwt'))
@Controller('families/:familyId/legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Get() list(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') familyId: string,
  ) {
    return this.legal.list(r.user.userId, familyId);
  }
  @Post('cases') createCase(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Body() dto: CreateLegalCaseDto,
  ) {
    return this.legal.createCase(r.user.userId, familyId, dto);
  }
  @Post('disclosures') createDisclosure(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Body() dto: CreateLegalDisclosureDto,
  ) {
    return this.legal.createDisclosure(r.user.userId, familyId, dto);
  }
  @Post('disclosures/:disclosureId/approve') approve(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('disclosureId') id: string,
  ) {
    return this.legal.approve(r.user.userId, familyId, id);
  }
  @Post('disclosures/:disclosureId/revoke') revoke(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('disclosureId') id: string,
    @Body() dto: RevokeLegalDisclosureDto,
  ) {
    return this.legal.revoke(r.user.userId, familyId, id, dto);
  }
  @Get('disclosures/:disclosureId/bundle') async bundle(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('disclosureId') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const bundle = await this.legal.bundle(r.user.userId, familyId, id);
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="coparent-legal-bundle-${id}.json"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    return bundle;
  }
}
