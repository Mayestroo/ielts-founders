import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { ExamSectionService } from './exam-section.service';

@Module({
  imports: [PrismaModule],
  providers: [ExamSectionService],
  exports: [ExamSectionService],
})
export class ExamContentModule {}
