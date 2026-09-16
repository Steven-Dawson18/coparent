import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { IdentityService } from './identity.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    UsersModule,
    PrismaModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('AUTH_MODE') === 'local'
          ? {
              secret: config.getOrThrow<string>('JWT_SECRET'),
              signOptions: {
                expiresIn: '10m',
                issuer: 'coparent-api',
                audience: 'coparent',
              },
            }
          : {},
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, IdentityService],
})
export class AuthModule {}
