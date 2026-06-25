import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class SubmitAnswersDto {
  @IsObject()
  answers: Record<string, unknown>; // Question ID to answer mapping

  @IsString()
  @IsNotEmpty()
  tabId: string;

  @IsBoolean()
  @IsOptional()
  isPartial?: boolean;
}

export class SaveHighlightsDto {
  @IsObject()
  highlights: Record<string, unknown>; // Passage/section highlights
}
