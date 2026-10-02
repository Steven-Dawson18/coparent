import { DocumentCategory, DocumentVisibility } from '@prisma/client';
import {
  IsISO8601,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateDocumentDto {
  @IsEnum(DocumentCategory) category!: DocumentCategory;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(5000) description?: string;
  @IsOptional() @IsUUID('4') expenseId?: string;
  @IsOptional() @IsString() @MaxLength(2000) childIds?: string;
  @IsOptional() @IsEnum(DocumentVisibility) visibility?: DocumentVisibility;
}

export class DocumentVisibilityDto {
  @IsEnum(DocumentVisibility) visibility!: DocumentVisibility;
}

export class GrantDocumentAccessDto {
  @IsUUID('4') userId!: string;
  @IsISO8601({ strict: true }) expiresAt!: string;
}

export class RevokeDocumentAccessDto {
  @IsUUID('4') userId!: string;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class ReviseDocumentDto {
  @IsEnum(DocumentCategory) category!: DocumentCategory;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(5000) description?: string;
  @IsString() @MinLength(1) @MaxLength(500) changeReason!: string;
}
