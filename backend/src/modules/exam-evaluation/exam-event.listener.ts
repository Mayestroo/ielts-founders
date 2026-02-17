import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { AiService } from '../ai/ai.service';
import { WRITING_GRADING_QUEUE } from '../queue/queue.module';
import { WritingGradingJobData } from '../queue/writing-grading.types';
import { PrismaService } from '../prisma/prisma.service';
import { ResponseCacheService } from '../redis';
import {
  WritingSubmittedEvent,
  WritingGradedEvent,
  WritingGradingFailedEvent,
  ExamSubmittedEvent,
  ExamStartedEvent,
} from '../exam-events/exam.events';

/**
 * Event listener that bridges domain events to infrastructure (queue)
 * This decouples the exams module from the queue implementation
 */
@Injectable()
export class ExamEventListener {
  private readonly logger = new Logger(ExamEventListener.name);

  constructor(
    @Optional()
    @InjectQueue(WRITING_GRADING_QUEUE)
    private readonly writingQueue?: Queue<WritingGradingJobData>,
    private readonly prisma?: PrismaService,
    private readonly aiService?: AiService,
    private readonly responseCache?: ResponseCacheService,
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  @OnEvent('writing.submitted')
  async handleWritingSubmitted(event: WritingSubmittedEvent) {
    this.logger.log(
      `Writing submitted event received for submission ${event.submissionId}`,
    );

    if (event.tasks.length === 0) {
      this.logger.warn(
        `No tasks to evaluate for submission ${event.submissionId}`,
      );
      return;
    }

    if (this.writingQueue) {
      try {
        await this.writingQueue.add(
          'grade',
          {
            submissionId: event.submissionId,
            resultId: event.resultId,
            tasks: event.tasks,
          },
          {
            jobId: `writing-${event.submissionId}`,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
          },
        );

        this.logger.log(`Job queued for submission ${event.submissionId}`);
        return;
      } catch (error) {
        this.logger.warn(
          `Queue unavailable for submission ${event.submissionId}, using inline grading fallback: ${error}`,
        );
      }
    }

    await this.processWritingInline(event);
  }

  private async processWritingInline(event: WritingSubmittedEvent) {
    if (
      !this.prisma ||
      !this.aiService ||
      !this.responseCache ||
      !this.eventEmitter
    ) {
      this.logger.error(
        `Inline grading dependencies missing for submission ${event.submissionId}`,
      );
      return;
    }

    try {
      await this.prisma.writingSubmission.update({
        where: { id: event.submissionId },
        data: {
          status: 'PROCESSING',
          processingAt: new Date(),
          attempts: { increment: 1 },
          jobId: null,
        },
      });

      const minTotalWeight = event.tasks.length === 2 ? 3 : event.tasks.length;
      const evaluation = await this.aiService.evaluateWritingSection(
        event.tasks,
        minTotalWeight,
      );

      await this.prisma.$transaction([
        this.prisma.writingSubmission.update({
          where: { id: event.submissionId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            bandScore: evaluation.bandScore,
            evaluation: evaluation as unknown as Prisma.InputJsonValue,
            lastError: null,
          },
        }),
        this.prisma.examResult.update({
          where: { id: event.resultId },
          data: {
            bandScore: evaluation.bandScore,
            feedback: evaluation as unknown as Prisma.InputJsonValue,
            score: evaluation.bandScore,
          },
        }),
      ]);

      await this.responseCache.delByPrefixes([
        'cache:results:list:v1:',
        'cache:results:student:v1:',
        'cache:dashboard:stats:v1:',
      ]);

      this.eventEmitter.emit(
        'writing.graded',
        new WritingGradedEvent(
          event.submissionId,
          event.resultId,
          event.studentId,
          evaluation.bandScore,
          evaluation,
        ),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown inline grading error';
      this.logger.error(
        `Inline grading failed for submission ${event.submissionId}: ${errorMessage}`,
      );

      await this.prisma.writingSubmission
        .update({
          where: { id: event.submissionId },
          data: {
            status: 'FAILED',
            lastError: errorMessage,
          },
        })
        .catch(() => undefined);

      this.eventEmitter.emit(
        'writing.gradingFailed',
        new WritingGradingFailedEvent(
          event.submissionId,
          event.resultId,
          event.studentId,
          errorMessage,
          1,
          1,
        ),
      );
    }
  }

  @OnEvent('writing.graded')
  handleWritingGraded(event: WritingGradedEvent) {
    this.logger.log(
      `Writing graded event: submission ${event.submissionId} scored ${event.bandScore}`,
    );
    // Additional business logic can be added here:
    // - Send notifications
    // - Update analytics
    // - Trigger webhooks
  }

  @OnEvent('writing.gradingFailed')
  handleWritingGradingFailed(event: WritingGradingFailedEvent) {
    this.logger.error(
      `Writing grading failed for submission ${event.submissionId}: ${event.error}`,
    );
    // Additional error handling:
    // - Alert administrators
    // - Send failure notification to student
    // - Log for manual review
  }

  @OnEvent('exam.submitted')
  handleExamSubmitted(event: ExamSubmittedEvent) {
    this.logger.log(
      `Exam submitted: ${event.sectionType} assignment ${event.assignmentId} by student ${event.studentId}`,
    );
    // Analytics, notifications, etc.
  }

  @OnEvent('exam.started')
  handleExamStarted(event: ExamStartedEvent) {
    this.logger.log(
      `Exam started: assignment ${event.assignmentId} by student ${event.studentId}`,
    );
    // Log exam start for analytics
  }
}
