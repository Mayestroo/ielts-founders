import { IsBoolean } from 'class-validator';

export class UpdateFullMockResultVisibilityDto {
  @IsBoolean()
  showResultsToStudent: boolean;
}
