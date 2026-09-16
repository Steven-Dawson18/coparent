import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async signIn(email: string, password: string) {
    if (this.config.getOrThrow<string>('AUTH_MODE') !== 'local') {
      throw new NotFoundException();
    }
    const user = await this.usersService.findAuthenticationRecord(email);
    const valid = user
      ? await bcrypt.compare(password, user.passwordHash)
      : await bcrypt.compare(password, UsersService.DUMMY_PASSWORD_HASH);

    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return {
      accessToken: await this.jwtService.signAsync({
        sub: user.id,
        email: user.email,
      }),
      tokenType: 'Bearer',
      expiresIn: 600,
    };
  }
}
