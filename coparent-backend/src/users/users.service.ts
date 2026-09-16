import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user-dto';
import { UpdateUserDto } from './dto/update-user-dto';

const publicUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  static readonly DUMMY_PASSWORD_HASH =
    '$2b$12$K2NJCLRQftxuxu1251P1weT3YwNpdJiNWoafldUUN8Xyo7oR32vyC';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateUserDto) {
    if (this.config.getOrThrow<string>('AUTH_MODE') !== 'local') {
      throw new NotFoundException();
    }
    const userId = randomUUID();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
        const user = await tx.user.create({
          data: {
            id: userId,
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            email: dto.email,
            passwordHash: await bcrypt.hash(dto.password, 12),
          },
          select: publicUserSelect,
        });
        await tx.auditEvent.create({
          data: {
            actorId: user.id,
            action: 'ACCOUNT_CREATED',
            entityType: 'User',
            entityId: user.id,
          },
        });
        return user;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'An account with those details already exists.',
        );
      }
      throw error;
    }
  }

  findAuthenticationRecord(email: string) {
    return this.prisma.$queryRaw<
      User[]
    >`SELECT * FROM find_coparent_local_auth_user(${email})`.then(
      (users) => users[0] ?? null,
    );
  }

  async findSelf(userId: string) {
    const user = await this.prisma.withActor(userId, (tx) =>
      tx.user.findUnique({
        where: { id: userId },
        select: publicUserSelect,
      }),
    );
    if (!user) throw new NotFoundException();
    return user;
  }

  async updateSelf(userId: string, dto: UpdateUserDto) {
    return this.prisma.withActor(userId, async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          ...(dto.firstName && { firstName: dto.firstName.trim() }),
          ...(dto.lastName && { lastName: dto.lastName.trim() }),
        },
        select: publicUserSelect,
      });
      await tx.auditEvent.create({
        data: {
          actorId: userId,
          action: 'ACCOUNT_PROFILE_UPDATED',
          entityType: 'User',
          entityId: userId,
        },
      });
      return user;
    });
  }
}
