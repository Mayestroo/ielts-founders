import {
  Role,
  SessionAttendanceMode,
  SessionReferralSource,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsEnum(Role)
  role: Role;

  @IsOptional()
  @IsString()
  centerId?: string;

  @IsOptional()
  @IsEnum(SessionAttendanceMode)
  sessionAttendanceMode?: SessionAttendanceMode;

  @IsOptional()
  @IsISO8601()
  sessionScheduledAt?: string;

  @IsOptional()
  @IsEnum(SessionReferralSource)
  sessionReferralSource?: SessionReferralSource;

  @IsOptional()
  @IsString()
  @Matches(/^\+998\d{9}$/)
  phoneNumber?: string;

  @IsOptional()
  @IsBoolean()
  premiumActive?: boolean;
}
