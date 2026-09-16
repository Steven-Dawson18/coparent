import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../types/authenticated-user';
import { ChildService } from './child.service';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@UseGuards(AuthGuard('jwt'))
@Controller('families/:familyId/children')
export class ChildController {
  constructor(private readonly childService: ChildService) {}

  @Get()
  list(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
  ) {
    return this.childService.list(request.user.userId, familyId);
  }

  @Get(':childId')
  get(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('childId') childId: string,
  ) {
    return this.childService.get(request.user.userId, familyId, childId);
  }

  @Post()
  create(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Body() dto: CreateChildDto,
  ) {
    return this.childService.create(request.user.userId, familyId, dto);
  }

  @Patch(':childId')
  update(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('childId') childId: string,
    @Body() dto: UpdateChildDto,
  ) {
    return this.childService.update(
      request.user.userId,
      familyId,
      childId,
      dto,
    );
  }
}
