import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { EvaluateWritingSectionInput } from '../ai/ielts-writing.types';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResponseCacheService } from '../redis';
import {
  buildWritingSectionResult,
  evaluateWritingTaskInputs,
  WritingTaskResults,
} from './writing-grading.util';

interface QuestionItem {
  id: string;
  type: string;
  questionText?: string;
  instruction?: string;
  imageUrl?: string;
}

const pickTextAnswer = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return '';
};

const countWords = (text: string): number =>
  text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0).length;

@Injectable()
export class WritingEvaluationService {
  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private responseCache: ResponseCacheService,
  ) {}

  async evaluateWriting(
    resultId: string,
    requesterId: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ) {
    const examResult = await this.prisma.examResult.findUnique({
      where: { id: resultId },
      include: {
        section: true,
        student: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
      },
    });

    if (!examResult) {
      throw new NotFoundException('Result not found');
    }

    if (examResult.section?.type !== 'WRITING') {
      throw new BadRequestException(
        'AI evaluation is only available for writing sections',
      );
    }

    if (
      requesterRole !== Role.SUPER_ADMIN &&
      (!requesterCenterId || examResult.section.centerId !== requesterCenterId)
    ) {
      throw new ForbiddenException('Access denied for another center');
    }

    const answers = (examResult.answers ?? {}) as Record<string, unknown>;
    const questions = this.getQuestionItems(examResult.section.questions);
    const taskInputs = this.buildTaskInputs(
      questions,
      answers,
      examResult.section.description,
    );

    if (taskInputs.length === 0) {
      throw new BadRequestException('No writing response found to evaluate');
    }

    try {
      const taskResults = await this.evaluateTaskInputs(taskInputs);
      const sectionResult = buildWritingSectionResult(taskResults);

      const updatedResult = await this.prisma.examResult.update({
        where: { id: resultId },
        data: {
          score: sectionResult.overall_band,
          totalScore: 9,
          bandScore: sectionResult.overall_band,
          feedback: sectionResult as unknown as Prisma.InputJsonValue,
        },
      });

      const latestAssignment = await this.prisma.examAssignment.findFirst({
        where: {
          studentId: examResult.studentId,
          sectionId: examResult.sectionId,
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          answers: true,
        },
      });

      if (latestAssignment) {
        const latestAnswers = (latestAssignment.answers ?? {}) as Record<
          string,
          unknown
        >;

        await this.prisma.examAssignment.update({
          where: { id: latestAssignment.id },
          data: {
            answers: {
              ...latestAnswers,
              _aiEvaluation: sectionResult,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }

      await this.prisma.writingSubmission.updateMany({
        where: { resultId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          bandScore: sectionResult.overall_band,
          aiResult: sectionResult as unknown as Prisma.InputJsonValue,
          evaluation: sectionResult as unknown as Prisma.InputJsonValue,
          lastError: null,
        },
      });

      await this.invalidateEvaluationReadCaches();

      return {
        ...updatedResult,
        aiEvaluation: sectionResult,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown AI evaluation error';

      await this.prisma.writingSubmission
        .updateMany({
          where: { resultId },
          data: {
            status: 'FAILED',
            lastError: errorMessage,
          },
        })
        .catch(() => undefined);

      throw new BadRequestException(`AI evaluation failed: ${errorMessage}`);
    }
  }

  async getWritingSubmissionStatus(
    submissionId: string,
    userId: string,
    userRole: Role,
    requesterCenterId: string | null,
  ) {
    const submission = await this.prisma.writingSubmission.findUnique({
      where: { id: submissionId },
      include: {
        result: {
          select: {
            id: true,
            bandScore: true,
            feedback: true,
            sectionId: true,
          },
        },
        section: {
          select: { title: true, centerId: true },
        },
      },
    });

    if (!submission) {
      throw new NotFoundException('Writing submission not found');
    }

    const isOwner = submission.studentId === userId;
    const isAdmin =
      userRole === Role.SUPER_ADMIN ||
      userRole === Role.CENTER_ADMIN ||
      userRole === Role.TEACHER;

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('Not authorized to view this submission');
    }

    if (
      isAdmin &&
      userRole !== Role.SUPER_ADMIN &&
      (!requesterCenterId || submission.section.centerId !== requesterCenterId)
    ) {
      throw new ForbiddenException('Access denied for another center');
    }

    return {
      id: submission.id,
      status: submission.status,
      queuedAt: submission.queuedAt,
      processingAt: submission.processingAt,
      completedAt: submission.completedAt,
      attempts: submission.attempts,
      maxAttempts: submission.maxAttempts,
      lastError: isAdmin ? submission.lastError : undefined,
      resultId: submission.resultId,
      bandScore: submission.bandScore,
      evaluation:
        submission.status === 'COMPLETED'
          ? (submission.aiResult ?? submission.evaluation)
          : undefined,
      sectionTitle: submission.section.title,
      isComplete: submission.status === 'COMPLETED',
      isFailed: submission.status === 'FAILED',
      canRetry:
        submission.status === 'FAILED' &&
        submission.attempts < submission.maxAttempts,
    };
  }

  private buildTaskInputs(
    questions: QuestionItem[],
    answers: Record<string, unknown>,
    sectionDescription: string | null,
  ): EvaluateWritingSectionInput[] {
    const inputs: EvaluateWritingSectionInput[] = [];

    if (questions?.[0]) {
      const essay = pickTextAnswer(answers.w1, answers.task1);
      if (essay.trim()) {
        inputs.push({
          taskType: 'task1',
          instruction:
            questions[0].instruction ||
            questions[0].questionText ||
            sectionDescription ||
            'IELTS Academic Writing Task 1',
          imageUrl: questions[0].imageUrl,
          essay,
          wordCount: countWords(essay),
        });
      }
    }

    if (questions?.[1]) {
      const essay = pickTextAnswer(answers.w2, answers.task2);
      if (essay.trim()) {
        inputs.push({
          taskType: 'task2',
          question:
            questions[1].questionText ||
            questions[1].instruction ||
            sectionDescription ||
            'IELTS Academic Writing Task 2',
          essay,
          wordCount: countWords(essay),
        });
      }
    }

    if (inputs.length === 0) {
      const fallbackEssay = pickTextAnswer(answers.writing);
      if (fallbackEssay) {
        inputs.push({
          taskType: 'task2',
          question: sectionDescription || 'IELTS Academic Writing Task 2',
          essay: fallbackEssay,
          wordCount: countWords(fallbackEssay),
        });
      }
    }

    return inputs;
  }

  private getQuestionItems(value: unknown): QuestionItem[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is QuestionItem => {
      if (!item || typeof item !== 'object') {
        return false;
      }

      const question = item as Record<string, unknown>;
      return (
        typeof question.id === 'string' && typeof question.type === 'string'
      );
    });
  }

  private async evaluateTaskInputs(
    taskInputs: EvaluateWritingSectionInput[],
  ): Promise<WritingTaskResults> {
    return evaluateWritingTaskInputs(this.aiService, taskInputs);
  }

  private async invalidateEvaluationReadCaches() {
    await this.responseCache.delByPrefixes([
      'cache:results:list:v1:',
      'cache:results:student:v1:',
      'cache:dashboard:stats:v1:',
    ]);
  }
}
