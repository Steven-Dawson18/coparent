import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateChildDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsDateString({ strict: true })
  dateOfBirth!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  school?: string;
}
