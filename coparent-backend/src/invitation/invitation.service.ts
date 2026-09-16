import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FamilyRole, InvitationStatus, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { EmailDeliveryService } from '../email/email-delivery.service';
import { EmailOutboxService } from '../email/email-outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AcceptedInvitation {
  invitationId: string;
  familyId: string;
  role: FamilyRole;
}

export interface DeclinedInvitation {
  invitationId: string;
  status: InvitationStatus;
}

export interface RevokedInvitation {
  invitationId: string;
  familyId: string;
  status: InvitationStatus;
}

const invitationSelect = {
  id: true,
  familyId: true,
  email: true,
  role: true,
  status: true,
  invitedById: true,
  createdAt: true,
  expiresAt: true,
  resolvedAt: true,
} satisfies Prisma.FamilyInvitationSelect;

@Injectable()
export class InvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: EmailOutboxService,
    private readonly delivery: EmailDeliveryService,
  ) {}

  async create(userId: string, familyId: string, dto: CreateInvitationDto) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const email = dto.email.trim().toLowerCase();
    const role = dto.role;

    try {
      const invitation = await this.prisma.withActor(userId, (tx) =>
        this.createRecord(tx, userId, familyId, email, role, tokenHash, token),
      );
      return this.present(invitation, token);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('An active invitation cannot be created.');
      }
      throw error;
    }
  }

  async resend(userId: string, familyId: string, invitationId: string) {
    const token = randomBytes(32).toString('base64url');
    try {
      const invitation = await this.prisma.withActor(userId, async (tx) => {
        const existing = await tx.familyInvitation.findFirst({
          where: { id: invitationId, familyId, status: 'PENDING' },
          select: { email: true, role: true },
        });
        if (!existing) throw new NotFoundException();

        const revoked = await tx.$queryRaw<RevokedInvitation[]>`
          SELECT * FROM revoke_coparent_family_invitation(${invitationId}, ${familyId})
        `;
        if (!revoked[0]) throw new NotFoundException();

        return this.createRecord(
          tx,
          userId,
          familyId,
          existing.email,
          existing.role,
          this.hashToken(token),
          token,
        );
      });
      return this.present(invitation, token);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('The invitation could not be resent.');
      }
      throw error;
    }
  }

  list(userId: string, familyId: string) {
    return this.prisma.withActor(userId, async (tx) => {
      const owner = await tx.familyMembership.findFirst({
        where: { familyId, userId, role: 'OWNER' },
        select: { familyId: true },
      });
      if (!owner) throw new NotFoundException();

      return tx.familyInvitation.findMany({
        where: { familyId },
        select: invitationSelect,
        orderBy: { createdAt: 'desc' },
      });
    });
  }

  async revoke(userId: string, familyId: string, invitationId: string) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<RevokedInvitation[]>`
          SELECT * FROM revoke_coparent_family_invitation(${invitationId}, ${familyId})
        `,
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  async accept(userId: string, token: string) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<AcceptedInvitation[]>`
        SELECT * FROM accept_coparent_family_invitation(${this.hashToken(token)})
      `,
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  async decline(userId: string, token: string) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<DeclinedInvitation[]>`
        SELECT * FROM decline_coparent_family_invitation(${this.hashToken(token)})
      `,
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private async createRecord(
    tx: Prisma.TransactionClient,
    userId: string,
    familyId: string,
    email: string,
    role: FamilyRole,
    tokenHash: string,
    token: string,
  ) {
    const owner = await tx.familyMembership.findFirst({
      where: { familyId, userId, role: 'OWNER' },
      select: { familyId: true },
    });
    if (!owner) throw new NotFoundException();

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${familyId}:${email}`}, 0))
    `;
    const existingMember = await tx.familyMembership.findFirst({
      where: { familyId, user: { email } },
      select: { userId: true },
    });
    if (existingMember) {
      throw new ConflictException('An active invitation cannot be created.');
    }
    const activeInvitation = await tx.familyInvitation.findFirst({
      where: {
        familyId,
        email,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (activeInvitation) {
      throw new ConflictException('An active invitation cannot be created.');
    }

    const created = await tx.familyInvitation.create({
      data: {
        familyId,
        email,
        role,
        tokenHash,
        invitedById: userId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
      select: invitationSelect,
    });
    await tx.auditEvent.create({
      data: {
        familyId,
        actorId: userId,
        action: 'FAMILY_INVITATION_CREATED',
        entityType: 'FamilyInvitation',
        entityId: created.id,
        metadata: { role },
      },
    });
    await this.outbox.enqueueInvitation(tx, created.id, token);
    return created;
  }

  private present<T extends object>(
    invitation: T,
    token: string,
  ): T & { token?: string } {
    return this.delivery.shouldRevealLocalToken()
      ? { ...invitation, token }
      : invitation;
  }
}
