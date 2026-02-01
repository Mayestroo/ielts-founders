import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ExamContentModule } from '../exam-content';
import { ExamEvaluationModule } from '../exam-evaluation';
import { ExamRuntimeModule } from '../exam-runtime';
import { ExamsController } from './exams.controller';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ExamContentModule,
    ExamRuntimeModule,
    ExamEvaluationModule,
  ],
  controllers: [ExamsController],
  exports: [ExamContentModule, ExamRuntimeModule, ExamEvaluationModule],
})
export class ExamsModule {}
