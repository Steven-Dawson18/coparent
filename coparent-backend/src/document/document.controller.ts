import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AuthenticatedUser } from '../types/authenticated-user';
import { DocumentService, UploadedDocumentFile } from './document.service';
import { CreateDocumentDto, ReviseDocumentDto } from './dto/document.dto';

interface R {
  user: AuthenticatedUser;
}
const uploadOptions = { limits: { fileSize: 10 * 1024 * 1024, files: 1 } };

@UseGuards(AuthGuard('jwt'))
@Controller('families/:familyId/documents')
export class DocumentController {
  constructor(private readonly service: DocumentService) {}

  @Get()
  list(
    @Request() r: R,
    @Param('familyId') familyId: string,
    @Query('childId') childId?: string,
    @Query('expenseId') expenseId?: string,
  ) {
    return this.service.list(r.user.userId, familyId, childId, expenseId);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  create(
    @Request() r: R,
    @Param('familyId') familyId: string,
    @Body() dto: CreateDocumentDto,
    @UploadedFile() file?: UploadedDocumentFile,
  ) {
    return this.service.create(r.user.userId, familyId, dto, file);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  revise(
    @Request() r: R,
    @Param('familyId') familyId: string,
    @Param('id') id: string,
    @Body() dto: ReviseDocumentDto,
    @UploadedFile() file?: UploadedDocumentFile,
  ) {
    return this.service.revise(r.user.userId, familyId, id, dto, file);
  }

  @Get(':id/history')
  history(
    @Request() r: R,
    @Param('familyId') familyId: string,
    @Param('id') id: string,
  ) {
    return this.service.history(r.user.userId, familyId, id);
  }

  @Get(':id/download')
  async download(
    @Request() r: R,
    @Param('familyId') familyId: string,
    @Param('id') id: string,
    @Query('versionId') versionId: string | undefined,
    @Res() response: Response,
  ) {
    const result = await this.service.download(
      r.user.userId,
      familyId,
      id,
      versionId,
    );
    response.setHeader('Content-Type', result.mediaType);
    response.setHeader('Content-Length', String(result.buffer.length));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
    );
    response.send(result.buffer);
  }
}
