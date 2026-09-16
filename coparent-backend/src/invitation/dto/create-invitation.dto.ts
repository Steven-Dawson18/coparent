import { IsEmail, IsEnum } from 'class-validator';

export enum InvitationRole {
  PARENT = 'PARENT',
  PROFESSIONAL_READ_ONLY = 'PROFESSIONAL_READ_ONLY',
}

export class CreateInvitationDto {
  @IsEmail()
  email!: string;

  @IsEnum(InvitationRole)
  role!: InvitationRole;
}
