import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../types/authenticated-user';

@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveExternalIdentity(
    issuer: string,
    subject: string,
  ): Promise<AuthenticatedUser | null> {
    const identities = await this.prisma.$queryRaw<AuthenticatedUser[]>`
      SELECT * FROM resolve_coparent_external_identity(${issuer}, ${subject})
    `;
    return identities[0] ?? null;
  }
}
