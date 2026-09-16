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
import { CreateMessageDto } from './dto/create-message.dto';
import { ListMessagesDto } from './dto/list-messages.dto';
import { MessageService } from './message.service';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@UseGuards(AuthGuard('jwt'))
@Controller('families/:familyId/messages')
export class MessageController {
  constructor(private readonly messages: MessageService) {}

  @Get()
  list(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.messages.list(request.user.userId, familyId, query);
  }

  @Post()
  create(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.messages.create(request.user.userId, familyId, dto);
  }

  @Post(':messageId/read')
  markRead(
    @Request() request: AuthenticatedRequest,
    @Param('familyId') familyId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messages.markRead(request.user.userId, familyId, messageId);
  }
}
