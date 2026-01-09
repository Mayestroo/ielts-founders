import { IsObject } from 'class-validator';

export class SubmitAnswersDto {
  @IsObject()
  answers: Record<string, any>; // Question ID to answer mapping
}

export class SaveHighlightsDto {
  @IsObject()
  highlights: Record<string, any>; // Passage/section highlights
}
