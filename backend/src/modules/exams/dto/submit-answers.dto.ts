import { IsNotEmpty, IsObject, IsString } from 'class-validator';

export class SubmitAnswersDto {
  @IsObject()
  answers: Record<string, any>; // Question ID to answer mapping

  @IsString()
  @IsNotEmpty()
  tabId: string;
}

export class SaveHighlightsDto {
  @IsObject()
  highlights: Record<string, any>; // Passage/section highlights
}
