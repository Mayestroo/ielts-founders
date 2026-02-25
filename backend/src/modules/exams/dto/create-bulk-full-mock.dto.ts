import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateBulkFullMockDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  studentIds: string[];

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
