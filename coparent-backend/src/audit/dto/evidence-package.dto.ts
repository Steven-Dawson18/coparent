import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
} from 'class-validator';

export const evidenceSections = [
  'chronology',
  'messages',
  'requests',
  'agreements',
  'calendar',
  'expenses',
  'documents',
  'handovers',
] as const;

export type EvidenceSection = (typeof evidenceSections)[number];

export class EvidencePackageDto {
  @IsISO8601({ strict: true })
  from!: string;

  @IsISO8601({ strict: true })
  to!: string;

  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(evidenceSections.length)
  @IsIn(evidenceSections, { each: true })
  sections!: EvidenceSection[];
}
