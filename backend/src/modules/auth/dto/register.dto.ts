import { IsString, MinLength } from 'class-validator';
import { SessionRegistrationDto } from './google-register.dto';

export class RegisterDto extends SessionRegistrationDto {
  @IsString()
  @MinLength(3)
  username: string;

  @IsString()
  @MinLength(6)
  password: string;
}
