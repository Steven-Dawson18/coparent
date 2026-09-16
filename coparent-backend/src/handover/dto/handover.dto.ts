import { HandoverOutcome } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
export class HandoverDto {
  @IsDateString() scheduledAt!: string;
  @IsString() @MinLength(1) @MaxLength(100) timeZone!: string;
  @IsString() @MinLength(1) @MaxLength(500) location!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(5000) notes?: string;
  @IsUUID('4') fromParentId!: string;
  @IsUUID('4') toParentId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  childIds!: string[];
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(160, { each: true })
  checklist!: string[];
}
export class ReviseHandoverDto extends HandoverDto {
  @IsString() @MinLength(1) @MaxLength(500) changeReason!: string;
}
export class CancelHandoverDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}
export class AcknowledgeHandoverDto {
  @IsEnum(HandoverOutcome) outcome!: HandoverOutcome;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) note?: string;
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  checkedItemIds!: string[];
}
