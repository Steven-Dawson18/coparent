import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { EvidenceSection } from '../audit/dto/evidence-package.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLegalCaseDto,
  CreateLegalDisclosureDto,
  RevokeLegalDisclosureDto,
} from './dto/legal.dto';

const disclosureSelect = {
  id: true,
  legalCaseId: true,
  familyId: true,
  title: true,
  periodFrom: true,
  periodTo: true,
  sections: true,
  recipientUserId: true,
  accessExpiresAt: true,
  status: true,
  createdById: true,
  createdAt: true,
  approvedAt: true,
  revokedAt: true,
  revocationReason: true,
  approvals: {
    orderBy: { approvedAt: 'asc' as const },
    select: {
      approvedAt: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  recipient: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  legalCase: {
    select: { caseReference: true, courtName: true, proceedingType: true },
  },
  documents: {
    select: {
      document: {
        select: {
          id: true,
          visibility: true,
          currentVersion: {
            select: {
              title: true,
              category: true,
              originalFileName: true,
              mediaType: true,
              plaintextSize: true,
              sha256: true,
              createdAt: true,
            },
          },
        },
      },
    },
  },
};

@Injectable()
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(userId: string, familyId: string) {
    return this.prisma.withActor(userId, async (tx) => {
      const cases = await tx.legalCase.findMany({
        where: { familyId },
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          disclosures: {
            orderBy: { createdAt: 'desc' },
            select: disclosureSelect,
          },
        },
      });
      return cases;
    });
  }

  async createCase(userId: string, familyId: string, dto: CreateLegalCaseDto) {
    const id = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ id: string | null }>>`
        SELECT create_coparent_legal_case(${id},${familyId},${dto.caseReference},${dto.courtName ?? null},${dto.proceedingType},${dto.details ?? null}) AS id`,
    );
    if (rows[0]?.id !== id) throw new NotFoundException();
    return { id };
  }

  async createDisclosure(
    userId: string,
    familyId: string,
    dto: CreateLegalDisclosureDto,
  ) {
    const id = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ id: string | null }>>`
        SELECT create_coparent_legal_disclosure(
          ${id},${dto.legalCaseId},${familyId},${dto.title},${new Date(dto.periodFrom)},
          ${new Date(dto.periodTo)},${dto.sections}::TEXT[],${dto.recipientUserId},
          ${new Date(dto.accessExpiresAt)},${dto.documentIds ?? []}::TEXT[]
        ) AS id`,
    );
    if (rows[0]?.id !== id) throw new NotFoundException();
    return { id, status: 'AWAITING_APPROVAL' };
  }

  async approve(userId: string, familyId: string, disclosureId: string) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ id: string | null }>>`
        SELECT approve_coparent_legal_disclosure(${disclosureId}) AS id`,
    );
    if (rows[0]?.id !== disclosureId) throw new NotFoundException();
    return this.getDisclosure(userId, familyId, disclosureId);
  }

  async revoke(
    userId: string,
    familyId: string,
    disclosureId: string,
    dto: RevokeLegalDisclosureDto,
  ) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ id: string | null }>>`
        SELECT revoke_coparent_legal_disclosure(${disclosureId},${dto.reason}) AS id`,
    );
    if (rows[0]?.id !== disclosureId) throw new NotFoundException();
    return { id: disclosureId, revoked: true };
  }

  async bundle(userId: string, familyId: string, disclosureId: string) {
    const disclosure = await this.getDisclosure(userId, familyId, disclosureId);
    const now = new Date();
    if (
      disclosure.status !== 'APPROVED' ||
      disclosure.accessExpiresAt.getTime() <= now.getTime()
    )
      throw new NotFoundException();

    const evidence = await this.audit.createPackage(
      userId,
      familyId,
      {
        from: disclosure.periodFrom.toISOString(),
        to: disclosure.periodTo.toISOString(),
        sections: disclosure.sections as EvidenceSection[],
      },
      {
        allowProfessional: true,
        recordAudit: false,
        documentIds: disclosure.documents.map((link) => link.document.id),
      },
    );
    await this.prisma.withActor(userId, (tx) =>
      tx.auditEvent.create({
        data: {
          id: randomUUID(),
          familyId,
          actorId: userId,
          action: 'LEGAL_BUNDLE_EXPORTED',
          entityType: 'LegalDisclosure',
          entityId: disclosureId,
        },
      }),
    );
    const content = {
      format: 'coparent-controlled-legal-bundle-v1',
      generatedAt: now.toISOString(),
      cover: {
        caseReference: disclosure.legalCase.caseReference,
        courtName: disclosure.legalCase.courtName,
        proceedingType: disclosure.legalCase.proceedingType,
        title: disclosure.title,
        period: { from: disclosure.periodFrom, to: disclosure.periodTo },
        recipient: disclosure.recipient,
        approvedAt: disclosure.approvedAt,
        accessExpiresAt: disclosure.accessExpiresAt,
      },
      index: Object.entries(evidence.counts).map(([section, records]) => ({
        section,
        records,
      })),
      sections: disclosure.sections,
      records: evidence.records,
      documents: disclosure.documents.map((link) => link.document),
      approvals: disclosure.approvals,
      notices: [
        'This bundle is a structured record export, not legal advice or a legal opinion.',
        'CoParent does not guarantee admissibility. Recipients must verify procedural and disclosure requirements independently.',
        'Document entries contain metadata and integrity hashes; files must be downloaded separately while access remains active.',
      ],
    };
    return {
      ...content,
      integrity: {
        algorithm: 'SHA-256',
        checksum: createHash('sha256')
          .update(JSON.stringify(content))
          .digest('hex'),
        scope:
          'UTF-8 JSON encoding of this document without the integrity property',
      },
    };
  }

  private async getDisclosure(userId: string, familyId: string, id: string) {
    const disclosure = await this.prisma.withActor(userId, (tx) =>
      tx.legalDisclosure.findFirst({
        where: { id, familyId },
        select: disclosureSelect,
      }),
    );
    if (!disclosure) throw new NotFoundException();
    return disclosure;
  }
}
