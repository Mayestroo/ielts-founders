import { ExamSectionType } from '@prisma/client';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, IsUrl, Min } from 'class-validator';

export class CreateExamSectionDto {
  @IsString()
  title: string;

  @IsEnum(ExamSectionType)
  type: ExamSectionType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1)
  duration: number; // Duration in minutes

  @IsArray()
  questions: any[]; // Array of question objects

  @IsOptional()
  @IsUrl()
  audioUrl?: string; // For listening sections

  @IsOptional()
  @IsArray()
  passages?: any[]; // For reading sections
}
