import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateFullMockDto {
  @IsString()
  studentId: string;

  @IsString()
  listeningSectionId: string;

  @IsString()
  readingSectionId: string;

  @IsString()
  writingSectionId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  breakMinutes?: number;
}
