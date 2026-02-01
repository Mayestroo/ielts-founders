import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AssignmentStatus, FullMockStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
import { AssignmentService } from './assignment.service';
import { ScoringService } from '../exam-evaluation/scoring.service';
import { SubmitAnswersDto } from '../exams/dto/submit-answers.dto';
import {
  ExamSubmittedEvent,
  WritingSubmittedEvent,
} from '../exam-events/exam.events';

interface QuestionItem {
  id: string;
  type: string;
  correctAnswer?: string | string[] | Record<string, string>;
  points?: number;
  questionText?: string;
  instruction?: string;
}

interface AssignmentWithSection {
  id: string;
  sectionId: string;
  studentId: string;
  fullMockSessionId?: string | null;
  fullMockSequence?: number | null;
  section: {
    type: string;
    questions: unknown;
    description: string | null;
  };
}

@Injectable()
export class SubmissionService {
  constructor(
    private prisma: PrismaService,
    private scoringService: ScoringService,
    private assignmentService: AssignmentService,
    private sessionService: SessionService,
    private eventEmitter: EventEmitter2,
  ) {}

  async submitAnswers(
    assignmentId: string,
    submitDto: SubmitAnswersDto,
    studentId: string,
  ): Promise<unknown> {
    const lockAcquired = await this.sessionService.acquireSubmitLock(
      assignmentId,
      studentId,
    );
    if (!lockAcquired) {
      const existing = await this.prisma.examAssignment.findUnique({
        where: { id: assignmentId },
        select: { status: true },
      });
      if (existing?.status === AssignmentStatus.SUBMITTED) {
        return { message: 'Already submitted', idempotent: true };
      }
      throw new ConflictException('Submit in progress, please wait');
    }

    try {
      const assignment = await this.prisma.examAssignment.findUnique({
        where: { id: assignmentId },
        include: { section: true },
      });

      if (!assignment) {
        throw new NotFoundException('Assignment not found');
      }

      if (assignment.studentId !== studentId) {
        throw new ForbiddenException('This assignment is not assigned to you');
      }

      if (assignment.status === AssignmentStatus.SUBMITTED) {
        return { message: 'Already submitted', idempotent: true };
      }

      await this.sessionService.markSubmitted(assignmentId);

      if (assignment.section.type === 'WRITING') {
        return await this.submitWritingAsync(
          assignment as AssignmentWithSection,
          submitDto,
          studentId,
        );
      } else {
        return await this.submitReadingListeningSync(
          assignment as AssignmentWithSection,
          submitDto,
          studentId,
        );
      }
    } finally {
      await this.sessionService.releaseSubmitLock(assignmentId);
    }
  }

  private async submitWritingAsync(
    assignment: AssignmentWithSection,
    submitDto: SubmitAnswersDto,
    studentId: string,
  ) {
    const answers = submitDto.answers as Record<string, string>;
    const questions = assignment.section.questions as QuestionItem[] | null;

    const tasksToEvaluate: {
      id: string;
      description: string;
      response: string;
    }[] = [];

    if (questions?.[0]) {
      tasksToEvaluate.push({
        id: 'Task 1',
        description:
          (questions[0].questionText as string) || 'IELTS Writing Task 1',
        response: answers['w1'] || answers['task1'] || '',
      });
    }

    if (questions?.[1]) {
      tasksToEvaluate.push({
        id: 'Task 2',
        description:
          (questions[1].questionText as string) || 'IELTS Writing Task 2',
        response: answers['w2'] || answers['task2'] || '',
      });
    }

    if (
      tasksToEvaluate.length === 0 &&
      (answers['writing'] || assignment.section.description)
    ) {
      tasksToEvaluate.push({
        id: 'Writing Task',
        description: assignment.section.description || 'IELTS Writing Task',
        response: answers['writing'] || '',
      });
    }

    const result = await this.prisma.examResult.create({
      data: {
        studentId,
        sectionId: assignment.sectionId,
        score: 0,
        totalScore: 9,
        bandScore: null,
        answers: submitDto.answers as Prisma.InputJsonValue,
        feedback: undefined,
      },
    });

    const submission = await this.prisma.writingSubmission.create({
      data: {
        resultId: result.id,
        studentId,
        sectionId: assignment.sectionId,
        task1Response: answers['w1'] || answers['task1'] || null,
        task2Response: answers['w2'] || answers['task2'] || null,
        status: 'QUEUED',
      },
    });

    await this.prisma.examAssignment.update({
      where: { id: assignment.id },
      data: {
        status: AssignmentStatus.SUBMITTED,
        answers: submitDto.answers as Prisma.InputJsonValue,
        score: 0,
      },
    });

    const mockProgress = await this.updateFullMockProgress(
      assignment.fullMockSessionId,
      assignment.fullMockSequence,
    );

    // Emit event instead of directly queuing - decouples from queue implementation
    this.eventEmitter.emit(
      'writing.submitted',
      new WritingSubmittedEvent(
        submission.id,
        result.id,
        studentId,
        assignment.sectionId,
        tasksToEvaluate,
      ),
    );

    // Also emit general exam submitted event
    this.eventEmitter.emit(
      'exam.submitted',
      new ExamSubmittedEvent(
        assignment.id,
        studentId,
        assignment.sectionId,
        'WRITING',
        null,
        result.id,
      ),
    );

    return {
      message: 'Exam submitted successfully',
      assignmentId: assignment.id,
      status: 'SUBMITTED',
      resultId: result.id,
      submissionId: submission.id,
      gradingStatus: 'queued',
      note: 'Writing evaluation is in progress. Results will be available soon.',
      nextAssignmentId: mockProgress?.nextAssignmentId ?? null,
      breakEndsAt: mockProgress?.breakEndsAt ?? null,
      fullMockSessionId: assignment.fullMockSessionId ?? null,
    };
  }

  private async submitReadingListeningSync(
    assignment: AssignmentWithSection,
    submitDto: SubmitAnswersDto,
    studentId: string,
  ) {
    const questions = assignment.section.questions as QuestionItem[];
    const calculation = this.scoringService.calculateScore(
      questions,
      submitDto.answers,
      assignment.section.type,
    );

    await this.prisma.examAssignment.update({
      where: { id: assignment.id },
      data: {
        status: AssignmentStatus.SUBMITTED,
        answers: submitDto.answers as Prisma.InputJsonValue,
        score: calculation.score,
      },
    });

    const result = await this.prisma.examResult.create({
      data: {
        studentId,
        sectionId: assignment.sectionId,
        score: calculation.score,
        totalScore: calculation.totalScore,
        bandScore: calculation.bandScore,
        answers: submitDto.answers as Prisma.InputJsonValue,
        feedback: undefined,
      },
    });

    // Emit exam submitted event
    this.eventEmitter.emit(
      'exam.submitted',
      new ExamSubmittedEvent(
        assignment.id,
        studentId,
        assignment.sectionId,
        assignment.section.type,
        calculation.score,
        result.id,
      ),
    );

    const mockProgress = await this.updateFullMockProgress(
      assignment.fullMockSessionId,
      assignment.fullMockSequence,
    );

    return {
      message: 'Exam submitted successfully',
      assignmentId: assignment.id,
      status: 'SUBMITTED',
      resultId: result.id,
      score: calculation.score,
      totalScore: calculation.totalScore,
      bandScore: calculation.bandScore,
      nextAssignmentId: mockProgress?.nextAssignmentId ?? null,
      breakEndsAt: mockProgress?.breakEndsAt ?? null,
      fullMockSessionId: assignment.fullMockSessionId ?? null,
    };
  }

  private async updateFullMockProgress(
    fullMockSessionId?: string | null,
    fullMockSequence?: number | null,
  ): Promise<
    | {
        nextAssignmentId: string | null;
        breakEndsAt: string | null;
      }
    | null
  > {
    if (!fullMockSessionId || !fullMockSequence) {
      return null;
    }

    const session = await this.prisma.fullMockSession.findUnique({
      where: { id: fullMockSessionId },
    });

    if (!session) {
      return null;
    }

    const nextAssignment = await this.prisma.examAssignment.findFirst({
      where: {
        fullMockSessionId,
        fullMockSequence: { gt: fullMockSequence },
      },
      orderBy: { fullMockSequence: 'asc' },
      select: { id: true, fullMockSequence: true },
    });

    if (!nextAssignment) {
      await this.prisma.fullMockSession.update({
        where: { id: fullMockSessionId },
        data: {
          status: FullMockStatus.COMPLETED,
          breakEndsAt: null,
        },
      });
      return { nextAssignmentId: null, breakEndsAt: null };
    }

    const breakEndsAt = new Date(
      Date.now() + session.breakMinutes * 60 * 1000,
    );

    await this.prisma.fullMockSession.update({
      where: { id: fullMockSessionId },
      data: {
        status: FullMockStatus.BREAK,
        breakEndsAt,
        currentSequence: nextAssignment.fullMockSequence ?? session.currentSequence,
      },
    });

    return {
      nextAssignmentId: nextAssignment.id,
      breakEndsAt: breakEndsAt.toISOString(),
    };
  }
}
