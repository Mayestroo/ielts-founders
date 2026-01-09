import { PartialType } from '@nestjs/mapped-types';
import { CreateExamSectionDto } from './create-exam-section.dto';

export class UpdateExamSectionDto extends PartialType(CreateExamSectionDto) {}
