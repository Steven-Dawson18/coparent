import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedUser } from '../types/authenticated-user';
import { CreateUserDto } from './dto/create-user-dto';
import { UpdateUserDto } from './dto/update-user-dto';
import { UsersService } from './users.service';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  getSelf(@Request() request: AuthenticatedRequest) {
    return this.usersService.findSelf(request.user.userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('me')
  updateSelf(
    @Request() request: AuthenticatedRequest,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateSelf(request.user.userId, dto);
  }
}
