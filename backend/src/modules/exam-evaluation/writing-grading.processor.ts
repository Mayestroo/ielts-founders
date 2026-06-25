import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { Job } from 'bullmq';
import { AiService } from '../ai/ai.service';
import {
  WritingGradedEvent,
  WritingGradingFailedEvent,
} from '../exam-events/exam.events';
import { PrismaService } from '../prisma/prisma.service';
import { WRITING_GRADING_QUEUE } from '../queue/queue.module';
import {
  WritingGradingJobData,
  WritingGradingResult,
} from '../queue/writing-grading.types';
import {
  buildWritingSectionResult,
  evaluateWritingTaskInputs,
} from './writing-grading.util';

@Processor(WRITING_GRADING_QUEUE, {
  concurrency: 3,
})
@Injectable()
export class WritingGradingProcessor extends WorkerHost {
  private readonly logger = new Logger(WritingGradingProcessor.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(
    job: Job<WritingGradingJobData>,
  ): Promise<WritingGradingResult> {
    const { submissionId, resultId, tasks } = job.data;
    this.logger.log(
      `Processing writing grading job ${job.id} for submission ${submissionId}`,
    );

    const submission = await this.prisma.writingSubmission.findUnique({
      where: { id: submissionId },
      select: { studentId: true },
    });

    if (!submission) {
      throw new Error(`Writing submission ${submissionId} not found`);
    }

    const studentId = submission.studentId;

    await this.prisma.writingSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'PROCESSING',
        processingAt: new Date(),
        attempts: { increment: 1 },
        jobId: job.id,
      },
    });

    try {
      const taskResults = await evaluateWritingTaskInputs(
        this.aiService,
        tasks,
      );
      const sectionResult = buildWritingSectionResult(taskResults);

      this.logger.log(
        `Grading completed for submission ${submissionId}, bandScore: ${sectionResult.overall_band}`,
      );

      await this.prisma.$transaction([
        this.prisma.writingSubmission.update({
          where: { id: submissionId },
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
          where: { id: resultId },
          data: {
            bandScore: sectionResult.overall_band,
            feedback: sectionResult as unknown as Prisma.InputJsonValue,
            score: sectionResult.overall_band,
          },
        }),
      ]);

      this.eventEmitter.emit(
        'writing.graded',
        new WritingGradedEvent(
          submissionId,
          resultId,
          studentId,
          sectionResult.overall_band,
          sectionResult,
        ),
      );

      return { success: true, bandScore: sectionResult.overall_band };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Grading failed for submission ${submissionId}: ${errorMessage}`,
      );

      await this.prisma.writingSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'FAILED',
          lastError: errorMessage,
        },
      });

      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<WritingGradingJobData>) {
    this.logger.log(`Job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<WritingGradingJobData> | undefined, error: Error) {
    if (!job) return;

    this.logger.error(`Job ${job.id} failed: ${error.message}`);

    const submission = await this.prisma.writingSubmission.findUnique({
      where: { id: job.data.submissionId },
      select: { studentId: true },
    });

    const studentId = submission?.studentId || 'unknown';
    const maxAttempts = job.opts?.attempts || 3;

    this.eventEmitter.emit(
      'writing.gradingFailed',
      new WritingGradingFailedEvent(
        job.data.submissionId,
        job.data.resultId,
        studentId,
        error.message,
        job.attemptsMade,
        maxAttempts,
      ),
    );

    if (job.attemptsMade >= maxAttempts) {
      this.logger.warn(
        `Job ${job.id} reached max attempts, keeping FAILED state`,
      );

      await this.prisma.writingSubmission.update({
        where: { id: job.data.submissionId },
        data: {
          status: 'FAILED',
          lastError: `Max retries reached. Last error: ${error.message}`,
        },
      });
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job<WritingGradingJobData>) {
    this.logger.log(
      `Job ${job.id} is now active (attempt ${job.attemptsMade + 1})`,
    );
  }
}
