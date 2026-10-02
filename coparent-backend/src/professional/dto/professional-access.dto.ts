import { Transform } from 'class-transformer';
import { ProfessionalScope, ProfessionalType } from '@prisma/client';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ConfigureProfessionalAccessDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  accessExpiresAt?: string | null;

  @IsOptional()
  @IsEnum(ProfessionalType)
  professionalType?: ProfessionalType;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(ProfessionalScope, { each: true })
  professionalScopes?: ProfessionalScope[];
}

export class RevokeProfessionalAccessDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
