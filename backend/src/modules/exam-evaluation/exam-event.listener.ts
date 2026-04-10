import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { AiService } from '../ai/ai.service';
import {
  EvaluateWritingSectionInput,
  IeltsWritingResult,
  IeltsWritingScores,
  IeltsWritingSectionResult,
} from '../ai/ielts-writing.types';
import {
  ExamStartedEvent,
  ExamSubmittedEvent,
  WritingGradedEvent,
  WritingGradingFailedEvent,
  WritingSubmittedEvent,
} from '../exam-events/exam.events';
import { PrismaService } from '../prisma/prisma.service';
import { WRITING_GRADING_QUEUE } from '../queue/queue.module';
import { WritingGradingJobData } from '../queue/writing-grading.types';
import { ResponseCacheService } from '../redis';

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

      const taskResults = await evaluateTaskInputs(this.aiService, event.tasks);
      const sectionResult = buildSectionResult(taskResults);

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
