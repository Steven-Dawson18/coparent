import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { RequestSecurityContext } from '../security/request-security-context.service';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private readonly requestContext: RequestSecurityContext) {
    super();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  withActor<T>(
    userId: string,
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      const professionalScope = this.requestContext.professionalScope;
      if (professionalScope) {
        await tx.$executeRaw`SELECT set_config('app.current_professional_scope', ${professionalScope}, true)`;
      }
      return callback(tx);
    });
  }
}
