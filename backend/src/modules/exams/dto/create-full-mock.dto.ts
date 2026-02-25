import { IsBoolean, IsOptional, IsString } from 'class-validator';

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
  @IsBoolean()
  showResultsToStudent?: boolean;
}
