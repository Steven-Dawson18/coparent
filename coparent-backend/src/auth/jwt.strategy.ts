import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { Algorithm } from 'jsonwebtoken';
import { AuthenticatedUser } from '../types/authenticated-user';
import { IdentityService } from './identity.service';

interface JwtPayload {
  sub?: string;
  email?: string;
  iss?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly authMode: 'local' | 'oidc';

  constructor(
    config: ConfigService,
    private readonly identities: IdentityService,
  ) {
    const authMode = config.getOrThrow<'local' | 'oidc'>('AUTH_MODE');
    const common = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      issuer:
        authMode === 'oidc'
          ? config.getOrThrow<string>('OIDC_ISSUER')
          : 'coparent-api',
      audience:
        authMode === 'oidc'
          ? config.getOrThrow<string>('OIDC_AUDIENCE')
          : 'coparent',
    };
    super(
      authMode === 'oidc'
        ? {
            ...common,
            algorithms: ['RS256'] as Algorithm[],
            secretOrKeyProvider: passportJwtSecret({
              cache: true,
              rateLimit: true,
              jwksRequestsPerMinute: 5,
              jwksUri: config.getOrThrow<string>('OIDC_JWKS_URI'),
            }),
          }
        : {
            ...common,
            algorithms: ['HS256'] as Algorithm[],
            secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
          },
    );
    this.authMode = authMode;
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sub) {
      throw new UnauthorizedException();
    }

    if (this.authMode === 'local') {
      if (!payload.email) throw new UnauthorizedException();
      return { userId: payload.sub, email: payload.email };
    }

    if (!payload.iss) throw new UnauthorizedException();
    const user = await this.identities.resolveExternalIdentity(
      payload.iss,
      payload.sub,
    );
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
