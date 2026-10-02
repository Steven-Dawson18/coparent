import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { evidenceSections } from '../../audit/dto/evidence-package.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateLegalCaseDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  caseReference!: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(200) courtName?: string;
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  proceedingType!: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(5000) details?: string;
}

export class CreateLegalDisclosureDto {
  @IsUUID('4') legalCaseId!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsISO8601({ strict: true }) periodFrom!: string;
  @IsISO8601({ strict: true }) periodTo!: string;
  @IsISO8601({ strict: true }) accessExpiresAt!: string;
  @IsUUID('4') recipientUserId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(evidenceSections.length)
  @ArrayUnique()
  @IsIn(evidenceSections, { each: true })
  sections!: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  documentIds?: string[];
}

export class RevokeLegalDisclosureDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}
