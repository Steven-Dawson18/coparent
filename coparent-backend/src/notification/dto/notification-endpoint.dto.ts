import { NotificationEndpointChannel } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterNotificationEndpointDto {
  @IsEnum(NotificationEndpointChannel) channel!: NotificationEndpointChannel;
  @IsString() @MinLength(1) @MaxLength(100) label!: string;
  @IsString() @MinLength(3) @MaxLength(2000) endpoint!: string;
  @IsOptional() @IsString() @MinLength(20) @MaxLength(500) publicKey?: string;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(500) authSecret?: string;
}
