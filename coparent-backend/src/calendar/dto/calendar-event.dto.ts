import { CalendarEventCategory } from '@prisma/client';
import {
  ArrayMaxSize,
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

export class CalendarEventDto {
  @IsEnum(CalendarEventCategory) category!: CalendarEventCategory;
  @IsString() @MinLength(1) @MaxLength(160) title!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(5000) description?: string;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsString() @MinLength(1) @MaxLength(100) timeZone!: string;
  @IsOptional() @IsUUID('4') responsibleParentId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  childIds?: string[];
}

export class ReviseCalendarEventDto extends CalendarEventDto {
  @IsString() @MinLength(1) @MaxLength(500) changeReason!: string;
}

export class CancelCalendarEventDto {
  @IsString() @MinLength(1) @MaxLength(500) changeReason!: string;
}
