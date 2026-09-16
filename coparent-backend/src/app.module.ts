import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ChildModule } from './child/child.module';
import { CalendarModule } from './calendar/calendar.module';
import { validateEnvironment } from './config/environment';
import { FamilyModule } from './family/family.module';
import { ExpenseModule } from './expense/expense.module';
import { DocumentModule } from './document/document.module';
import { FamilyRequestModule } from './family-request/family-request.module';
import { InvitationModule } from './invitation/invitation.module';
import { HandoverModule } from './handover/handover.module';
import { MessageModule } from './message/message.module';
import { NotificationModule } from './notification/notification.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    UsersModule,
    AuthModule,
    FamilyModule,
    InvitationModule,
    ChildModule,
    CalendarModule,
    MessageModule,
    FamilyRequestModule,
    ExpenseModule,
    HandoverModule,
    DocumentModule,
    NotificationModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
