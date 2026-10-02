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
import { NotificationPreferenceDto } from './dto/notification-preference.dto';
import { RegisterNotificationEndpointDto } from './dto/notification-endpoint.dto';
import { NotificationService } from './notification.service';
interface R {
  user: AuthenticatedUser;
}

@UseGuards(AuthGuard('jwt'))
@Controller('notifications')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}
  @Get() list(@Request() r: R) {
    return this.service.list(r.user.userId);
  }
  @Get('unread-count') count(@Request() r: R) {
    return this.service.unreadCount(r.user.userId);
  }
  @Post(':id/read') read(@Request() r: R, @Param('id') id: string) {
    return this.service.markRead(r.user.userId, id);
  }
  @Post('read-all') readAll(@Request() r: R) {
    return this.service.markAllRead(r.user.userId);
  }
  @Get('preferences') preferences(@Request() r: R) {
    return this.service.preferences(r.user.userId);
  }
  @Patch('preferences') setPreference(
    @Request() r: R,
    @Body() dto: NotificationPreferenceDto,
  ) {
    return this.service.setPreference(r.user.userId, dto);
  }
  @Get('endpoints') endpoints(@Request() r: R) {
    return this.service.endpoints(r.user.userId);
  }
  @Post('endpoints') registerEndpoint(
    @Request() r: R,
    @Body() dto: RegisterNotificationEndpointDto,
  ) {
    return this.service.registerEndpoint(r.user.userId, dto);
  }
  @Post('endpoints/:id/revoke') revokeEndpoint(
    @Request() r: R,
    @Param('id') id: string,
  ) {
    return this.service.revokeEndpoint(r.user.userId, id);
  }
}
