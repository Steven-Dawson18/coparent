import { DocumentCategory } from '@prisma/client';
import {
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
}

export class ReviseDocumentDto {
  @IsEnum(DocumentCategory) category!: DocumentCategory;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(5000) description?: string;
  @IsString() @MinLength(1) @MaxLength(500) changeReason!: string;
}
