import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job } from 'bullmq';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { WRITING_GRADING_QUEUE } from '../queue/queue.module';
import {
  WritingGradingJobData,
  WritingGradingResult,
} from '../queue/writing-grading.types';
import {
  WritingGradedEvent,
  WritingGradingFailedEvent,
} from '../exam-events/exam.events';

@Processor(WRITING_GRADING_QUEUE, {
  concurrency: 3, // Process 3 jobs in parallel per worker
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

    // Get submission details for event emission
    const submission = await this.prisma.writingSubmission.findUnique({
      where: { id: submissionId },
      select: { studentId: true },
    });

    if (!submission) {
      throw new Error(`Writing submission ${submissionId} not found`);
    }

    const studentId = submission.studentId;

    // Mark as processing
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
      // Call AI service (10-60s)
      const minTotalWeight = tasks.length === 2 ? 3 : tasks.length;
      const evaluation = await this.aiService.evaluateWritingSection(
        tasks,
        minTotalWeight,
      );

      this.logger.log(
        `Grading completed for submission ${submissionId}, bandScore: ${evaluation.bandScore}`,
      );

      // Update results in a transaction
      await this.prisma.$transaction([
        this.prisma.writingSubmission.update({
          where: { id: submissionId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            bandScore: evaluation.bandScore,
            evaluation: evaluation as any,
            lastError: null,
          },
        }),
        this.prisma.examResult.update({
          where: { id: resultId },
          data: {
            bandScore: evaluation.bandScore,
            feedback: evaluation as any,
            score: evaluation.bandScore,
          },
        }),
      ]);

      // Emit success event
      this.eventEmitter.emit(
        'writing.graded',
        new WritingGradedEvent(
          submissionId,
          resultId,
          studentId,
          evaluation.bandScore,
          evaluation,
        ),
      );

      return { success: true, bandScore: evaluation.bandScore };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Grading failed for submission ${submissionId}: ${errorMessage}`,
      );

      // Update submission with error
      await this.prisma.writingSubmission.update({
        where: { id: submissionId },
        data: { lastError: errorMessage },
      });

      throw error; // BullMQ will retry based on job options
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

    // Get submission details for event emission
    const submission = await this.prisma.writingSubmission.findUnique({
      where: { id: job.data.submissionId },
      select: { studentId: true },
    });

    const studentId = submission?.studentId || 'unknown';
    const maxAttempts = job.opts?.attempts || 3;

    // Emit failure event
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

    // Check if max retries reached
    if (job.attemptsMade >= maxAttempts) {
      this.logger.warn(`Job ${job.id} reached max attempts, marking as FAILED`);

      // Mark as permanently failed
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
