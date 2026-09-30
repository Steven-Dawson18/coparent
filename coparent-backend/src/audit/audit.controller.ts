import { Controller, Get, Param, Query, Request, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AuthenticatedUser } from '../types/authenticated-user';
import { AuditService } from './audit.service';
import { EvidenceExportDto, ListAuditEventsDto } from './dto/list-audit-events.dto';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@UseGuards(AuthGuard('jwt'))
@Controller('families/:familyId')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('audit-events')
  list(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Query() query: ListAuditEventsDto,
  ) {
    return this.audit.list(request.user.userId, familyId, query);
  }

  @Get('evidence-export')
  async export(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Query() query: EvidenceExportDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.audit.export(request.user.userId, familyId, query);
    const date = new Date().toISOString().slice(0, 10);
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="coparent-evidence-${date}.json"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    return result;
  }
}
