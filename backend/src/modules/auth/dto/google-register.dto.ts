import {
  IsEnum,
  IsISO8601,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum SessionAttendanceModeDto {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
}

export enum SessionReferralSourceDto {
  TELEGRAM = 'TELEGRAM',
  INSTAGRAM = 'INSTAGRAM',
  FACEBOOK = 'FACEBOOK',
  GOOGLE = 'GOOGLE',
  FRIENDS = 'FRIENDS',
  OTHER = 'OTHER',
}

export class SessionRegistrationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @IsEnum(SessionAttendanceModeDto)
  attendanceMode: SessionAttendanceModeDto;

  @IsISO8601()
  scheduledAt: string;

  @IsEnum(SessionReferralSourceDto)
  referralSource: SessionReferralSourceDto;

  @IsString()
  @Matches(/^\+998\d{9}$/)
  phoneNumber: string;
}

export class GoogleRegisterDto extends SessionRegistrationDto {
  @IsString()
  @MinLength(20)
  idToken: string;
}
