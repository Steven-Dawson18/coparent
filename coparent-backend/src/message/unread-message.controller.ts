import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../types/authenticated-user';
import { MessageService } from './message.service';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@UseGuards(AuthGuard('jwt'))
@Controller('messages')
export class UnreadMessageController {
  constructor(private readonly messages: MessageService) {}

  @Get('unread-count')
  unreadCount(@Request() request: AuthenticatedRequest) {
    return this.messages.unreadCount(request.user.userId);
  }
}
