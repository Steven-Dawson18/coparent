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

  @IsOptional() @IsString() @MaxLength(2000) contactInformation?: string;
  @IsOptional() @IsString() @MaxLength(200) emergencyContactName?: string;
  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyContactRelationship?: string;
  @IsOptional() @IsString() @MaxLength(50) emergencyContactPhone?: string;
  @IsOptional() @IsString() @MaxLength(200) gpName?: string;
  @IsOptional() @IsString() @MaxLength(50) gpPhone?: string;
  @IsOptional() @IsString() @MaxLength(200) dentistName?: string;
  @IsOptional() @IsString() @MaxLength(50) dentistPhone?: string;
  @IsOptional() @IsString() @MaxLength(5000) medicalNotes?: string;
  @IsOptional() @IsString() @MaxLength(3000) clubsAndActivities?: string;
}
