import { ArrangementFrequency } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
export class CreateLivingArrangementDto {
  @IsString() @MinLength(1) @MaxLength(160) label!: string;
  @IsEnum(ArrangementFrequency) frequency!: ArrangementFrequency;
  @IsInt() @Min(1) @Max(7) dayOfWeek!: number;
  @IsInt() @Min(0) @Max(1439) startMinute!: number;
  @IsInt() @Min(1) @Max(10080) durationMinutes!: number;
  @IsDateString({ strict: true }) effectiveStart!: string;
  @IsOptional() @IsDateString({ strict: true }) effectiveEnd?: string;
  @IsString() @MinLength(1) @MaxLength(100) timeZone!: string;
  @IsUUID('4') responsibleParentId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  childIds!: string[];
}
export class SkipLivingOccurrenceDto {
  @IsDateString({ strict: true }) occurrenceDate!: string;
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class CreateLivingPatternDto {
  @IsString() @MinLength(1) @MaxLength(160) label!: string;
  @IsDateString({ strict: true }) effectiveStart!: string;
  @IsOptional() @IsDateString({ strict: true }) effectiveEnd?: string;
  @IsString() @MinLength(1) @MaxLength(100) timeZone!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => LivingPatternSegmentDto)
  segments!: LivingPatternSegmentDto[];
}

export class LivingPatternSegmentDto {
  @IsInt() @Min(1) @Max(2) weekNumber!: number;
  @IsInt() @Min(1) @Max(7) dayOfWeek!: number;
  @IsInt() @Min(0) @Max(1439) startMinute!: number;
  @IsInt() @Min(1) @Max(10080) durationMinutes!: number;
  @IsUUID('4') responsibleParentId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  childIds!: string[];
}

export class CancelLivingArrangementDto {
  @IsString() @MinLength(1) @MaxLength(500) changeReason!: string;
}

export class CancelLivingPatternDto extends CancelLivingArrangementDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(14)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  arrangementIds!: string[];
}
