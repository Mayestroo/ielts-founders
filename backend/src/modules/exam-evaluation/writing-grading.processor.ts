import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { Job } from 'bullmq';
import { AiService } from '../ai/ai.service';
import {
  EvaluateWritingSectionInput,
  IeltsWritingResult,
  IeltsWritingScores,
  IeltsWritingSectionResult,
} from '../ai/ielts-writing.types';
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

const roundBand = (value: number): number => Math.round(value * 2) / 2;

const emptyScores = (): IeltsWritingScores => ({
  task_achievement: 0,
  coherence_cohesion: 0,
  lexical_resource: 0,
  grammar: 0,
});

const buildSectionResult = (
  taskResults: Partial<Record<'task1' | 'task2', IeltsWritingResult>>,
): IeltsWritingSectionResult => {
  const weights: Record<'task1' | 'task2', number> = {
    task1: 1,
    task2: 2,
  };

  const available = (['task1', 'task2'] as const).filter((taskType) =>
    Boolean(taskResults[taskType]),
  );

  if (available.length === 0) {
    throw new Error('No writing task evaluations available');
  }

  const totalWeight = available.reduce(
    (sum, taskType) => sum + weights[taskType],
    0,
  );

  const weightedScores = available.reduce((acc, taskType) => {
    const result = taskResults[taskType]!;
    const weight = weights[taskType];

    return {
      task_achievement:
        acc.task_achievement + result.scores.task_achievement * weight,
      coherence_cohesion:
        acc.coherence_cohesion + result.scores.coherence_cohesion * weight,
      lexical_resource:
        acc.lexical_resource + result.scores.lexical_resource * weight,
      grammar: acc.grammar + result.scores.grammar * weight,
    };
  }, emptyScores());

  const normalizedScores: IeltsWritingScores = {
    task_achievement: roundBand(weightedScores.task_achievement / totalWeight),
    coherence_cohesion: roundBand(
      weightedScores.coherence_cohesion / totalWeight,
    ),
    lexical_resource: roundBand(weightedScores.lexical_resource / totalWeight),
    grammar: roundBand(weightedScores.grammar / totalWeight),
  };

  const weightedBand = roundBand(
    available.reduce(
      (sum, taskType) =>
        sum + taskResults[taskType]!.overall_band * weights[taskType],
      0,
    ) / totalWeight,
  );

  return {
    overall_band: weightedBand,
    word_count_penalty: available.some(
      (taskType) => taskResults[taskType]!.word_count_penalty,
    ),
    task1: taskResults.task1,
    task2: taskResults.task2,
    weighted_scores: normalizedScores,
  };
};

const evaluateTaskInputs = async (
  aiService: AiService,
  taskInputs: EvaluateWritingSectionInput[],
): Promise<Partial<Record<'task1' | 'task2', IeltsWritingResult>>> => {
  const result: Partial<Record<'task1' | 'task2', IeltsWritingResult>> = {};

  for (const taskInput of taskInputs) {
    if (!taskInput.essay.trim()) {
      continue;
    }

    result[taskInput.taskType] =
      await aiService.evaluateWritingSection(taskInput);
  }

  return result;
};

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
      const taskResults = await evaluateTaskInputs(this.aiService, tasks);
      const sectionResult = buildSectionResult(taskResults);

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
