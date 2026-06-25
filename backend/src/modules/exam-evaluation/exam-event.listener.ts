import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { AiService } from '../ai/ai.service';
import {
  ExamStartedEvent,
  ExamSubmittedEvent,
  SpeakingSubmittedEvent,
  WritingGradedEvent,
  WritingGradingFailedEvent,
  WritingSubmittedEvent,
} from '../exam-events/exam.events';
import { PrismaService } from '../prisma/prisma.service';
import { WRITING_GRADING_QUEUE } from '../queue/queue.module';
import { WritingGradingJobData } from '../queue/writing-grading.types';
import { ResponseCacheService } from '../redis';
import {
  buildWritingSectionResult,
  evaluateWritingTaskInputs,
} from './writing-grading.util';

@Injectable()
export class ExamEventListener {
  private readonly logger = new Logger(ExamEventListener.name);

  constructor(
    @Optional()
    @InjectQueue(WRITING_GRADING_QUEUE)
    private readonly writingQueue: Queue<WritingGradingJobData> | undefined,
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly responseCache: ResponseCacheService,
    private readonly eventEmitter: EventEmitter2,
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

      const taskResults = await evaluateWritingTaskInputs(
        this.aiService,
        event.tasks,
      );
      const sectionResult = buildWritingSectionResult(taskResults);

      await this.prisma.$transaction([
        this.prisma.writingSubmission.update({
          where: { id: event.submissionId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            bandScore: sectionResult.overall_band,
            aiResult: sectionResult as unknown as Prisma.InputJsonValue,
            evaluation: sectionResult as unknown as Prisma.InputJsonValue,
            lastError: null,
          },
        }),
        this.prisma.examResult.update({
          where: { id: event.resultId },
          data: {
            bandScore: sectionResult.overall_band,
            feedback: sectionResult as unknown as Prisma.InputJsonValue,
            score: sectionResult.overall_band,
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
          sectionResult.overall_band,
          sectionResult,
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

  @OnEvent('speaking.submitted')
  async handleSpeakingSubmitted(event: SpeakingSubmittedEvent) {
    this.logger.log(
      `Speaking submitted event received for result ${event.resultId}`,
    );

    if (event.parts.length === 0) {
      await this.markSpeakingFailed(
        event,
        'No speaking recordings to evaluate',
      );
      return;
    }

    try {
      const evaluatedParts: Array<{
        partNumber: number;
        questionId: string;
        prompt: string;
        audioUrl: string;
        transcription: string;
        evaluation: unknown;
        bandScore: number;
      }> = [];

      for (const part of event.parts) {
        const transcription = await this.aiService.transcribeAudioFromUrl(
          part.audioUrl,
        );

        const speakingEvaluation = await this.aiService.evaluateSpeakingSection(
          {
            prompt: part.prompt,
            transcription,
            audioDurationSeconds: part.audioDurationSeconds,
          },
        );

        evaluatedParts.push({
          partNumber: part.partNumber,
          questionId: part.questionId,
          prompt: part.prompt,
          audioUrl: part.audioUrl,
          transcription,
          evaluation: speakingEvaluation,
          bandScore: speakingEvaluation.overall_band,
        });
      }

      const averageBand =
        evaluatedParts.reduce((sum, part) => sum + part.bandScore, 0) /
        evaluatedParts.length;
      const overallBand = Math.min(
        9,
        Math.max(0, Math.round(averageBand * 2) / 2),
      );

      const feedback = {
        status: 'COMPLETED',
        parts: evaluatedParts,
        summary: {
          evaluatedParts: evaluatedParts.length,
          overallBand,
        },
      };

      await this.prisma.$transaction([
        this.prisma.examResult.update({
          where: { id: event.resultId },
          data: {
            score: overallBand,
            bandScore: overallBand,
            feedback: feedback as unknown as Prisma.InputJsonValue,
          },
        }),
        this.prisma.examAssignment.update({
          where: { id: event.assignmentId },
          data: { score: overallBand },
        }),
      ]);

      await this.responseCache.delByPrefixes([
        'cache:results:list:v1:',
        'cache:results:student:v1:',
        'cache:assignments:student:v1:',
        'cache:dashboard:stats:v1:',
      ]);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown speaking grading error';
      this.logger.error(
        `Speaking grading failed for result ${event.resultId}: ${message}`,
      );
      await this.markSpeakingFailed(event, message);
    }
  }

  private async markSpeakingFailed(
    event: SpeakingSubmittedEvent,
    errorMessage: string,
  ) {
    await this.prisma.examResult
      .update({
        where: { id: event.resultId },
        data: {
          feedback: {
            status: 'FAILED',
            error: errorMessage,
          } as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);

    await this.responseCache
      .delByPrefixes(['cache:results:list:v1:', 'cache:results:student:v1:'])
      .catch(() => undefined);
  }

  @OnEvent('writing.graded')
  handleWritingGraded(event: WritingGradedEvent) {
    this.logger.log(
      `Writing graded event: submission ${event.submissionId} scored ${event.bandScore}`,
    );
  }

  @OnEvent('writing.gradingFailed')
  handleWritingGradingFailed(event: WritingGradingFailedEvent) {
    this.logger.error(
      `Writing grading failed for submission ${event.submissionId}: ${event.error}`,
    );
  }

  @OnEvent('exam.submitted')
  handleExamSubmitted(event: ExamSubmittedEvent) {
    this.logger.log(
      `Exam submitted: ${event.sectionType} assignment ${event.assignmentId} by student ${event.studentId}`,
    );
  }

  @OnEvent('exam.started')
  handleExamStarted(event: ExamStartedEvent) {
    this.logger.log(
      `Exam started: assignment ${event.assignmentId} by student ${event.studentId}`,
    );
  }
}
