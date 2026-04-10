import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class ManualGradeSpeakingDto {
  @IsNumber()
  @Min(0)
  @Max(9)
  fluencyCoherence: number;

  @IsNumber()
  @Min(0)
  @Max(9)
  lexicalResource: number;

  @IsNumber()
  @Min(0)
  @Max(9)
  grammaticalRangeAccuracy: number;

  @IsNumber()
  @Min(0)
  @Max(9)
  pronunciation: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9)
  overallBand?: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
