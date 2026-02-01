import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService, WritingEvaluation } from '../ai/ai.service';

interface QuestionItem {
  id: string;
  type: string;
  questionText?: string;
}

interface SectionEvaluationResult {
  bandScore: number;
  tasks: Record<string, WritingEvaluation>;
}

@Injectable()
export class WritingEvaluationService {
  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
  ) {}

  async evaluateWriting(
    resultId: string,
    requesterId: string,
    requesterRole: Role,
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

    const assignment = await this.prisma.examAssignment.findUnique({
      where: {
        studentId_sectionId: {
          studentId: examResult.studentId,
          sectionId: examResult.sectionId,
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Associated assignment not found');
    }

    const answers = (assignment.answers ?? {}) as Record<string, unknown>;
    const tasksToEvaluate: {
      id: string;
      description: string;
      response: string;
    }[] = [];

    const questions = examResult.section.questions as QuestionItem[] | null;

    if (questions?.[0]) {
      tasksToEvaluate.push({
        id: 'Task 1',
        description: questions[0].questionText || 'Task 1',
        response: String(answers['w1'] || answers['task1'] || ''),
      });
    }
    if (questions?.[1]) {
      tasksToEvaluate.push({
        id: 'Task 2',
        description: questions[1].questionText || 'Task 2',
        response: String(answers['w2'] || answers['task2'] || ''),
      });
    }

    let evaluation: WritingEvaluation | SectionEvaluationResult;

    if (tasksToEvaluate.length > 0) {
      const minTotalWeight =
        questions?.length === 2 ? 3 : tasksToEvaluate.length;
      evaluation = await this.aiService.evaluateWritingSection(
        tasksToEvaluate,
        minTotalWeight,
      );
    } else {
      const w1 = answers?.['w1'];
      const w2 = answers?.['w2'];
      const writing = answers?.['writing'];
      const writingResponse =
        typeof (w1 || w2 || writing) === 'string'
          ? ((w1 || w2 || writing) as string)
          : '';

      if (!writingResponse) {
        throw new BadRequestException('No writing response found to evaluate');
      }

      evaluation = await this.aiService.evaluateWritingTask(
        examResult.section.description || 'IELTS Writing Task',
        writingResponse,
      );
    }

    const updatedResult = await this.prisma.examResult.update({
      where: { id: resultId },
      data: {
        score: evaluation.bandScore,
        totalScore: 9,
        bandScore: evaluation.bandScore,
        feedback: evaluation as unknown as any,
      },
    });

    await this.prisma.examAssignment.update({
      where: { id: assignment.id },
      data: {
        answers: {
          ...answers,
          _aiEvaluation: evaluation,
        } as unknown as any,
      },
    });

    return {
      ...updatedResult,
      aiEvaluation: evaluation,
    };
  }

  async getWritingSubmissionStatus(
    submissionId: string,
    userId: string,
    userRole: Role,
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
          select: { title: true },
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
        submission.status === 'COMPLETED' ? submission.evaluation : undefined,
      sectionTitle: submission.section.title,
      isComplete: submission.status === 'COMPLETED',
      isFailed: submission.status === 'FAILED',
      canRetry:
        submission.status === 'FAILED' &&
        submission.attempts < submission.maxAttempts,
    };
  }
}
