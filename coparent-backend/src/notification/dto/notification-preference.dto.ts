import { NotificationType } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, Max, Min } from 'class-validator';

export class NotificationPreferenceDto {
  @IsEnum(NotificationType) type!: NotificationType;
  @IsBoolean() inAppEnabled!: boolean;
  @IsBoolean() emailEnabled!: boolean;
  @IsBoolean() pushEnabled!: boolean;
  @IsBoolean() smsEnabled!: boolean;
  @IsInt() @Min(1) @Max(168) reminderLeadHours!: number;
}
