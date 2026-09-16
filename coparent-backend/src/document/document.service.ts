import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocumentDto, ReviseDocumentDto } from './dto/document.dto';
import { FILE_STORAGE_SERVICE, FileStorageService } from './file-storage';

export interface UploadedDocumentFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const allowedMediaTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const versionPublicSelect = {
  id: true,
  revision: true,
  category: true,
  title: true,
  description: true,
  originalFileName: true,
  mediaType: true,
  plaintextSize: true,
  sha256: true,
  changedById: true,
  changeReason: true,
  createdAt: true,
  changedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.DocumentVersionSelect;
const documentSelect = {
  id: true,
  familyId: true,
  createdById: true,
  expenseId: true,
  createdAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  children: {
    include: {
      child: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  currentVersion: { select: versionPublicSelect },
  messageAttachment: { select: { messageId: true } },
  requestAttachment: { select: { requestId: true } },
  responseAttachment: { select: { responseId: true } },
} satisfies Prisma.DocumentSelect;

@Injectable()
export class DocumentService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE) private readonly storage: FileStorageService,
  ) {}

  list(userId: string, familyId: string, childId?: string, expenseId?: string) {
    return this.prisma.withActor(userId, (tx) =>
      tx.document.findMany({
        where: {
          familyId,
          ...(childId && { children: { some: { childId } } }),
          ...(expenseId && { expenseId }),
        },
        select: documentSelect,
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
    );
  }

  async create(
    userId: string,
    familyId: string,
    dto: CreateDocumentDto,
    file?: UploadedDocumentFile,
  ) {
    this.validateFile(file);
    const childIds = this.parseChildIds(dto.childIds);
    const encrypted = await this.storage.store(file.buffer);
    const id = randomUUID(),
      versionId = randomUUID();
    try {
      const rows = await this.prisma.withActor(
        userId,
        (tx) => tx.$queryRaw<Array<{ documentId: string | null }>>`
          SELECT create_coparent_document(
            ${id},${versionId},${familyId},${dto.expenseId ?? null},${dto.category},
            ${dto.title},${dto.description ?? null},${this.cleanFileName(file.originalname)},
            ${file.mimetype},${encrypted.plaintextSize}::INTEGER,${encrypted.sha256},
            ${encrypted.storageKey},${encrypted.initializationVector},
            ${encrypted.authenticationTag},${encrypted.encryptionKeyVersion}::INTEGER,
            ${childIds}::TEXT[]
          ) AS "documentId"`,
      );
      if (rows[0]?.documentId !== id) throw new NotFoundException();
    } catch (cause) {
      await this.storage.remove(encrypted.storageKey);
      throw cause;
    }
    return this.get(userId, familyId, id);
  }

  async revise(
    userId: string,
    familyId: string,
    id: string,
    dto: ReviseDocumentDto,
    file?: UploadedDocumentFile,
  ) {
    this.validateFile(file);
    const attached = await this.prisma.withActor(userId, (tx) =>
      tx.document.findFirst({
        where: {
          id,
          familyId,
          OR: [
            { messageAttachment: { isNot: null } },
            { requestAttachment: { isNot: null } },
            { responseAttachment: { isNot: null } },
          ],
        },
        select: { id: true },
      }),
    );
    if (attached)
      throw new BadRequestException(
        'An attached document is permanent. Upload a separate document instead.',
      );
    const encrypted = await this.storage.store(file.buffer);
    const versionId = randomUUID();
    try {
      const rows = await this.prisma.withActor(
        userId,
        (tx) => tx.$queryRaw<Array<{ documentId: string | null }>>`
          SELECT revise_coparent_document(
            ${id},${versionId},${familyId},${dto.category},${dto.title},
            ${dto.description ?? null},${this.cleanFileName(file.originalname)},${file.mimetype},
            ${encrypted.plaintextSize}::INTEGER,${encrypted.sha256},${encrypted.storageKey},
            ${encrypted.initializationVector},${encrypted.authenticationTag},
            ${encrypted.encryptionKeyVersion}::INTEGER,${dto.changeReason}
          ) AS "documentId"`,
      );
      if (rows[0]?.documentId !== id) throw new NotFoundException();
    } catch (cause) {
      await this.storage.remove(encrypted.storageKey);
      throw cause;
    }
    return this.get(userId, familyId, id);
  }

  async history(userId: string, familyId: string, id: string) {
    const item = await this.prisma.withActor(userId, (tx) =>
      tx.document.findFirst({
        where: { id, familyId },
        select: {
          versions: {
            select: versionPublicSelect,
            orderBy: { revision: 'desc' },
          },
        },
      }),
    );
    if (!item) throw new NotFoundException();
    return item.versions;
  }

  async download(
    userId: string,
    familyId: string,
    id: string,
    versionId?: string,
  ) {
    const version = await this.prisma.withActor(userId, (tx) =>
      tx.documentVersion.findFirst({
        where: {
          ...(versionId
            ? { id: versionId, documentId: id }
            : { currentFor: { id } }),
          document: { familyId },
        },
        select: {
          id: true,
          originalFileName: true,
          mediaType: true,
          plaintextSize: true,
          sha256: true,
          storageKey: true,
          initializationVector: true,
          authenticationTag: true,
          encryptionKeyVersion: true,
        },
      }),
    );
    if (!version) throw new NotFoundException();
    const buffer = await this.storage.read(version);
    const audited = await this.prisma.withActor(
      userId,
      (tx) =>
        tx.$queryRaw<Array<{ allowed: boolean }>>`
        SELECT audit_coparent_document_download(${id},${familyId},${version.id}) AS allowed`,
    );
    if (!audited[0]?.allowed) throw new NotFoundException();
    return {
      buffer,
      fileName: version.originalFileName,
      mediaType: version.mediaType,
    };
  }

  private async get(userId: string, familyId: string, id: string) {
    const item = await this.prisma.withActor(userId, (tx) =>
      tx.document.findFirst({
        where: { id, familyId },
        select: documentSelect,
      }),
    );
    if (!item) throw new NotFoundException();
    return item;
  }

  private validateFile(
    file?: UploadedDocumentFile,
  ): asserts file is UploadedDocumentFile {
    if (!file?.buffer?.length)
      throw new BadRequestException('A file is required.');
    if (file.size > 10 * 1024 * 1024)
      throw new BadRequestException('Files must not exceed 10 MB.');
    if (!allowedMediaTypes.has(file.mimetype))
      throw new BadRequestException('This file type is not permitted.');
    if (!this.matchesFileSignature(file.mimetype, file.buffer))
      throw new BadRequestException(
        'The file contents do not match its declared type.',
      );
  }

  private parseChildIds(value?: string): string[] {
    if (!value) return [];
    try {
      const ids: unknown = JSON.parse(value);
      if (
        !Array.isArray(ids) ||
        ids.length > 20 ||
        ids.some((id) => typeof id !== 'string')
      )
        throw new Error();
      return [...new Set(ids as string[])];
    } catch {
      throw new BadRequestException('childIds must be a JSON array.');
    }
  }

  private cleanFileName(name: string) {
    const safe = [...name]
      .map((character) => {
        const code = character.charCodeAt(0);
        return code < 32 ||
          code === 127 ||
          character === '/' ||
          character === '\\'
          ? '_'
          : character;
      })
      .join('');
    return safe.slice(0, 255) || 'document';
  }

  private matchesFileSignature(mediaType: string, buffer: Buffer) {
    const starts = (...bytes: number[]) =>
      bytes.every((value, index) => buffer[index] === value);
    if (mediaType === 'application/pdf')
      return buffer.subarray(0, 5).toString() === '%PDF-';
    if (mediaType === 'image/jpeg') return starts(0xff, 0xd8, 0xff);
    if (mediaType === 'image/png')
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    if (mediaType === 'image/webp')
      return (
        buffer.subarray(0, 4).toString() === 'RIFF' &&
        buffer.subarray(8, 12).toString() === 'WEBP'
      );
    if (mediaType === 'text/plain') return !buffer.includes(0);
    if (
      mediaType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
      return starts(0x50, 0x4b, 0x03, 0x04);
    return false;
  }
}
