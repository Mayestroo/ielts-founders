import { Module } from '@nestjs/common';
import { AiModule } from '../ai';
import { PrismaModule } from '../prisma';
import { QueueModule } from '../queue';
import { ExamEventListener } from './exam-event.listener';
import { ResultService } from './result.service';
import { ScoringService } from './scoring.service';
import { WritingEvaluationService } from './writing-evaluation.service';
import { WritingGradingProcessor } from './writing-grading.processor';

@Module({
  imports: [AiModule, QueueModule, PrismaModule],
  providers: [
    ScoringService,
    WritingEvaluationService,
    ResultService,
    ExamEventListener,
    WritingGradingProcessor,
  ],
  exports: [ScoringService, WritingEvaluationService, ResultService],
})
export class ExamEvaluationModule {}
