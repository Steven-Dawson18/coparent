import { UserResponseDto } from '../users/dto/user-response-dto';

declare module 'express' {
  interface Request {
    user?: UserResponseDto;
  }
}
