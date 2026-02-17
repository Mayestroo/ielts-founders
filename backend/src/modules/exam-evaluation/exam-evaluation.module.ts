import { Module, Provider } from '@nestjs/common';
import { AiModule } from '../ai';
import { PrismaModule } from '../prisma';
import { QueueModule, isWritingQueueEnabled } from '../queue';
import { ExamEventListener } from './exam-event.listener';
import { ResultService } from './result.service';
import { ScoringService } from './scoring.service';
import { WritingEvaluationService } from './writing-evaluation.service';
import { WritingGradingProcessor } from './writing-grading.processor';

const writingQueueEnabled = isWritingQueueEnabled();

const examEvaluationProviders: Provider[] = [
  ScoringService,
  WritingEvaluationService,
  ResultService,
  ExamEventListener,
];

if (
  writingQueueEnabled &&
  process.env.DISABLE_WRITING_QUEUE_WORKER !== 'true'
) {
  examEvaluationProviders.push(WritingGradingProcessor);
}

@Module({
  imports: writingQueueEnabled
    ? [AiModule, QueueModule, PrismaModule]
    : [AiModule, PrismaModule],
  providers: examEvaluationProviders,
  exports: [ScoringService, WritingEvaluationService, ResultService],
})
export class ExamEvaluationModule {}
