import { IsString } from 'class-validator';

export class CreateAssignmentDto {
  @IsString()
  studentId: string;

  @IsString()
  sectionId: string;
}
