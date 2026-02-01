import { Module } from '@nestjs/common';
import { ExamEvaluationModule } from '../exam-evaluation';
import { PrismaModule } from '../prisma';
import { SessionModule } from '../session';
import { AssignmentService } from './assignment.service';
import { ExamSessionService } from './exam-session.service';
import { SubmissionService } from './submission.service';

@Module({
  imports: [PrismaModule, SessionModule, ExamEvaluationModule],
  providers: [AssignmentService, ExamSessionService, SubmissionService],
  exports: [AssignmentService, ExamSessionService, SubmissionService],
})
export class ExamRuntimeModule {}
