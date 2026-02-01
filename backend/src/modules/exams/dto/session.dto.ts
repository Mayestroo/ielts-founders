import { IsNotEmpty, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export class SyncAnswersDto {
  @IsObject()
  @IsNotEmpty()
  answers: Record<string, unknown>;

  @IsOptional()
  @IsObject({ each: true })
  highlights?: unknown[];

  @IsNumber()
  @IsOptional()
  syncVersion?: number;
}

export class HeartbeatDto {
  @IsString()
  @IsOptional()
  tabId?: string;
}

export class ReconnectDto {
  @IsObject()
  @IsOptional()
  clientAnswers?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  tabId?: string;
}
