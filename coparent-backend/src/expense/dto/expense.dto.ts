import { Type } from 'class-transformer';
import {
  ExpenseCategory,
  ExpenseResponseType,
  RecurringExpenseFrequency,
} from '@prisma/client';
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

export class ExpenseAllocationDto {
  @IsUUID('4') userId!: string;
  @IsInt() @Min(0) @Max(10000) basisPoints!: number;
}

export class ExpenseDto {
  @IsEnum(ExpenseCategory) category!: ExpenseCategory;
  @IsString() @MinLength(1) @MaxLength(160) title!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(5000) description?: string;
  @IsInt() @Min(1) @Max(100000000) amountMinor!: number;
  @IsDateString({ strict: true }) incurredOn!: string;
  @IsUUID('4') paidById!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ExpenseAllocationDto)
  allocations!: ExpenseAllocationDto[];
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  childIds!: string[];
}

export class CreateExpenseDto extends ExpenseDto {
  @IsUUID('4') respondentId!: string;
}

export class ReviseExpenseDto extends ExpenseDto {
  @IsString() @MinLength(1) @MaxLength(500) changeReason!: string;
}

export class RespondExpenseDto {
  @IsEnum(ExpenseResponseType) responseType!: ExpenseResponseType;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) note?: string;
}

export class CreateRecurringExpenseDto extends ExpenseDto {
  @IsEnum(RecurringExpenseFrequency) frequency!: RecurringExpenseFrequency;
  @IsDateString({ strict: true }) startDate!: string;
  @IsOptional() @IsDateString({ strict: true }) endDate?: string;
}

export class CancelRecurringExpenseDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}
