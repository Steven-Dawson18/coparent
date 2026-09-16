import { IsDateString } from 'class-validator';
export class ListCalendarDto {
  @IsDateString() from!: string;
  @IsDateString() to!: string;
}
