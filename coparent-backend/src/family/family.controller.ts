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
import { CreateFamilyDto } from './dto/create-family.dto';
import { FamilyService } from './family.service';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@UseGuards(AuthGuard('jwt'))
@Controller('families')
export class FamilyController {
  constructor(private readonly familyService: FamilyService) {}

  @Post()
  create(
    @Request() request: AuthenticatedRequest,
    @Body() dto: CreateFamilyDto,
  ) {
    return this.familyService.create(request.user.userId, dto);
  }

  @Get()
  list(@Request() request: AuthenticatedRequest) {
    return this.familyService.listForUser(request.user.userId);
  }

  @Get(':familyId')
  get(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
  ) {
    return this.familyService.getForUser(request.user.userId, familyId);
  }
}
