import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AssignmentStatus, FullMockStatus, Prisma } from '@prisma/client';
import { ScoringService } from '../exam-evaluation/scoring.service';
import {
  ExamSubmittedEvent,
  WritingSubmittedEvent,
} from '../exam-events/exam.events';
import { SubmitAnswersDto } from '../exams/dto/submit-answers.dto';
import { PrismaService } from '../prisma/prisma.service';
import { ResponseCacheService } from '../redis';
import { SessionService } from '../session/session.service';

const SUBMIT_GRACE_PERIOD_MS = 60_000;

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
  private readonly logger = new Logger(SubmissionService.name);

  constructor(
    private prisma: PrismaService,
    private scoringService: ScoringService,
    private sessionService: SessionService,
    private eventEmitter: EventEmitter2,
    private responseCache: ResponseCacheService,
  ) {}

  async submitAnswers(
    assignmentId: string,
    submitDto: SubmitAnswersDto,
    studentId: string,
  ): Promise<unknown> {
    const tabId = submitDto.tabId?.trim();
    if (!tabId) {
      throw new BadRequestException('tabId is required for submit');
    }

    let lockAcquired = false;
    let lockEnabled = true;

    try {
      lockAcquired = await this.sessionService.acquireSubmitLock(
        assignmentId,
        studentId,
      );
    } catch {
      lockEnabled = false;
      this.logger.warn(
        `Redis submit lock unavailable for assignment ${assignmentId}, continuing with DB idempotency fallback`,
      );
    }

    if (lockEnabled && !lockAcquired) {
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
      const lockOk = await this.sessionService.refreshExamLock(
        assignmentId,
        tabId,
      );
      if (!lockOk) {
        throw new ConflictException('Exam is open in another tab');
      }
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      this.logger.warn(
        `Redis exam lock unavailable for assignment ${assignmentId}, continuing with DB fallback`,
      );
    }

    try {
      // [PERF-FIX] Fetch only required section fields, avoids loading large passages JSON — see /performance-audit/
      const assignment = await this.prisma.examAssignment.findUnique({
        where: { id: assignmentId },
        include: {
          section: {
            select: {
              type: true,
              questions: true,
              description: true,
            },
          },
        },
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

      if (assignment.status !== AssignmentStatus.IN_PROGRESS) {
        throw new BadRequestException('Exam is not active');
      }

      const isPracticeSubmission =
        submitDto.isPartial === true && !assignment.fullMockSessionId;

      if (!isPracticeSubmission) {
        if (!assignment.endTime) {
          throw new BadRequestException('Exam end time is missing');
        }

        const now = Date.now();
        const gracePeriodEnd =
          assignment.endTime.getTime() + SUBMIT_GRACE_PERIOD_MS;
        if (now > gracePeriodEnd) {
          throw new BadRequestException('Exam time has expired');
        }
      }

      let submitResult: unknown;
      const persistedAnswers = this.buildPersistedAnswers(
        submitDto.answers as Record<string, unknown>,
        assignment as AssignmentWithSection,
        isPracticeSubmission,
      );

      const targetStatus = AssignmentStatus.SUBMITTED;

      if (assignment.section.type === 'WRITING') {
        submitResult = await this.submitWritingAsync(
          assignment as AssignmentWithSection,
          persistedAnswers,
          studentId,
          targetStatus,
        );
      } else {
        submitResult = await this.submitReadingListeningSync(
          assignment as AssignmentWithSection,
          persistedAnswers,
          studentId,
          targetStatus,
        );
      }

      const isIdempotent =
        (submitResult as { idempotent?: boolean }).idempotent === true;

      // Only mark Redis session submitted if it's a full submit
      if (!isIdempotent && !isPracticeSubmission) {
        try {
          await this.sessionService.markSubmitted(assignmentId);
        } catch {
          this.logger.warn(
            `Failed to mark Redis session submitted for assignment ${assignmentId}`,
          );
        }

        await this.invalidateSubmissionReadCaches();
      }

      // If partial, we still invalidate caches to update answers/score
      if (isPracticeSubmission) {
        await this.invalidateSubmissionReadCaches();
      }

      return submitResult;
    } finally {
      if (lockEnabled && lockAcquired) {
        try {
          await this.sessionService.releaseSubmitLock(assignmentId);
        } catch {
          this.logger.warn(
            `Failed to release submit lock for assignment ${assignmentId}`,
          );
        }
      }
    }
  }

  private async submitWritingAsync(
    assignment: AssignmentWithSection,
    persistedAnswers: Record<string, unknown>,
    studentId: string,
    targetStatus: AssignmentStatus = AssignmentStatus.SUBMITTED,
  ) {
    const answers = persistedAnswers as Record<string, string>;
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

    const persisted = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.examAssignment.updateMany({
        where: {
          id: assignment.id,
          status: { not: AssignmentStatus.SUBMITTED },
        },
        data: {
          status: targetStatus,
          answers: persistedAnswers as Prisma.InputJsonValue,
          score: 0,
        },
      });

      if (claimed.count === 0) {
        return { alreadySubmitted: true as const };
      }

      const result = await tx.examResult.create({
        data: {
          studentId,
          sectionId: assignment.sectionId,
          score: 0,
          totalScore: 9,
          bandScore: null,
          answers: persistedAnswers as Prisma.InputJsonValue,
          feedback: undefined,
        },
      });

      const submission = await tx.writingSubmission.create({
        data: {
          resultId: result.id,
          studentId,
          sectionId: assignment.sectionId,
          task1Response: answers['w1'] || answers['task1'] || null,
          task2Response: answers['w2'] || answers['task2'] || null,
          status: 'QUEUED',
        },
      });

      const mockProgress = await this.updateFullMockProgressInTransaction(
        tx,
        assignment.fullMockSessionId,
        assignment.fullMockSequence,
      );

      return {
        alreadySubmitted: false as const,
        result,
        submission,
        mockProgress,
      };
    });

    if (persisted.alreadySubmitted) {
      return { message: 'Already submitted', idempotent: true };
    }

    const { result, submission, mockProgress } = persisted;

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
      status: 'SUBMITTED', // Always return SUBMITTED to frontend even if partial
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
    persistedAnswers: Record<string, unknown>,
    studentId: string,
    targetStatus: AssignmentStatus = AssignmentStatus.SUBMITTED,
  ) {
    const questions = assignment.section.questions as QuestionItem[];
    const calculation = this.scoringService.calculateScore(
      questions,
      persistedAnswers,
      assignment.section.type,
    );

    const persisted = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.examAssignment.updateMany({
        where: {
          id: assignment.id,
          status: { not: AssignmentStatus.SUBMITTED },
        },
        data: {
          status: targetStatus,
          answers: persistedAnswers as Prisma.InputJsonValue,
          score: calculation.score,
        },
      });

      if (claimed.count === 0) {
        return { alreadySubmitted: true as const };
      }

      const result = await tx.examResult.create({
        data: {
          studentId,
          sectionId: assignment.sectionId,
          score: calculation.score,
          totalScore: calculation.totalScore,
          bandScore: calculation.bandScore,
          answers: persistedAnswers as Prisma.InputJsonValue,
          feedback: undefined,
        },
      });

      const mockProgress = await this.updateFullMockProgressInTransaction(
        tx,
        assignment.fullMockSessionId,
        assignment.fullMockSequence,
      );

      return {
        alreadySubmitted: false as const,
        result,
        mockProgress,
      };
    });

    if (persisted.alreadySubmitted) {
      return { message: 'Already submitted', idempotent: true };
    }

    const { result, mockProgress } = persisted;

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

    return {
      message: 'Exam submitted successfully',
      assignmentId: assignment.id,
      status: 'SUBMITTED', // Always return SUBMITTED to frontend even if partial
      resultId: result.id,
      score: calculation.score,
      totalScore: calculation.totalScore,
      bandScore: calculation.bandScore,
      nextAssignmentId: mockProgress?.nextAssignmentId ?? null,
      breakEndsAt: mockProgress?.breakEndsAt ?? null,
      fullMockSessionId: assignment.fullMockSessionId ?? null,
    };
  }

  private buildPersistedAnswers(
    rawAnswers: Record<string, unknown>,
    assignment: AssignmentWithSection,
    isPracticeSubmission: boolean,
  ): Record<string, unknown> {
    const persistedAnswers: Record<string, unknown> = { ...rawAnswers };

    const incomingAttemptType =
      typeof persistedAnswers._attemptType === 'string'
        ? persistedAnswers._attemptType.trim()
        : '';
    persistedAnswers._attemptType = incomingAttemptType || 'Full';

    if (typeof persistedAnswers._attemptMode !== 'string') {
      persistedAnswers._attemptMode = isPracticeSubmission
        ? 'standalone'
        : 'full-mock';
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        persistedAnswers,
        '_fullMockSessionId',
      )
    ) {
      persistedAnswers._fullMockSessionId =
        assignment.fullMockSessionId ?? null;
    }

    const questionCount =
      Array.isArray(assignment.section.questions) &&
      assignment.section.questions.length > 0
        ? assignment.section.questions.length
        : 0;

    const incomingQuestionCount = persistedAnswers._attemptQuestionCount;
    const hasValidIncomingQuestionCount =
      typeof incomingQuestionCount === 'number' &&
      Number.isFinite(incomingQuestionCount) &&
      incomingQuestionCount > 0;

    if (!hasValidIncomingQuestionCount) {
      persistedAnswers._attemptQuestionCount = questionCount;
    }

    return persistedAnswers;
  }

  private async updateFullMockProgressInTransaction(
    tx: Prisma.TransactionClient,
    fullMockSessionId?: string | null,
    fullMockSequence?: number | null,
  ): Promise<{
    nextAssignmentId: string | null;
    breakEndsAt: string | null;
  } | null> {
    if (!fullMockSessionId || !fullMockSequence) {
      return null;
    }

    const session = await tx.fullMockSession.findUnique({
      where: { id: fullMockSessionId },
    });

    if (!session) {
      return null;
    }

    const nextAssignment = await tx.examAssignment.findFirst({
      where: {
        fullMockSessionId,
        fullMockSequence: { gt: fullMockSequence },
      },
      orderBy: { fullMockSequence: 'asc' },
      select: { id: true, fullMockSequence: true },
    });

    if (!nextAssignment) {
      await tx.fullMockSession.update({
        where: { id: fullMockSessionId },
        data: {
          status: FullMockStatus.COMPLETED,
          breakEndsAt: null,
        },
      });
      return { nextAssignmentId: null, breakEndsAt: null };
    }

    const breakEndsAt = new Date(Date.now() + session.breakMinutes * 60 * 1000);

    await tx.fullMockSession.update({
      where: { id: fullMockSessionId },
      data: {
        status: FullMockStatus.BREAK,
        breakEndsAt,
        currentSequence:
          nextAssignment.fullMockSequence ?? session.currentSequence,
      },
    });

    return {
      nextAssignmentId: nextAssignment.id,
      breakEndsAt: breakEndsAt.toISOString(),
    };
  }

  private async invalidateSubmissionReadCaches() {
    await this.responseCache.delByPrefixes([
      'cache:assignments:grouped:v1:',
      'cache:assignments:student:v1:',
      'cache:results:list:v1:',
      'cache:results:student:v1:',
      'cache:dashboard:stats:v1:',
    ]);
  }
}
