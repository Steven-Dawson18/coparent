import { IsString, Length } from 'class-validator';

export class ResolveInvitationDto {
  @IsString()
  @Length(43, 128)
  token!: string;
}
