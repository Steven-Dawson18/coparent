import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ConfigureProfessionalAccessDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  accessExpiresAt?: string | null;
}

export class RevokeProfessionalAccessDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
