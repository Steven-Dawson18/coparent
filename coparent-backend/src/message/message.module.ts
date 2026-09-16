import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';
import { UnreadMessageController } from './unread-message.controller';

@Module({
  imports: [PrismaModule],
  controllers: [MessageController, UnreadMessageController],
  providers: [MessageService],
})
export class MessageModule {}
