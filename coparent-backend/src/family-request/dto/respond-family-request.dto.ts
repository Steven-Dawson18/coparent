import { RequestResponseType } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RespondFamilyRequestDto {
  @IsEnum(RequestResponseType)
  responseType!: RequestResponseType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  details?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  attachmentIds?: string[];
}
