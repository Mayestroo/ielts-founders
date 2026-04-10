import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AssignmentStatus, FullMockStatus, Prisma } from '@prisma/client';
import { ScoringService } from '../exam-evaluation/scoring.service';
import {
  ExamSubmittedEvent,
  WritingSubmittedEvent,
} from '../exam-events/exam.events';
import { AiService } from '../ai/ai.service';
import { EvaluateWritingSectionInput } from '../ai/ielts-writing.types';
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
  imageUrl?: string;
}

const countWords = (text: string): number =>
  text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0).length;

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
    private aiService: AiService,
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
      } else if (assignment.section.type === 'SPEAKING') {
        submitResult = await this.submitSpeakingWithAi(
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

    const tasksToEvaluate: EvaluateWritingSectionInput[] = [];

    if (questions?.[0]) {
      const essay = answers['w1'] || answers['task1'] || '';
      if (essay.trim()) {
        tasksToEvaluate.push({
          taskType: 'task1',
          instruction:
            (questions[0].instruction as string) ||
            (questions[0].questionText as string) ||
            'IELTS Academic Writing Task 1',
          imageUrl: (questions[0].imageUrl as string) || undefined,
          essay,
          wordCount: countWords(essay),
        });
      }
    }

    if (questions?.[1]) {
      const essay = answers['w2'] || answers['task2'] || '';
      if (essay.trim()) {
        tasksToEvaluate.push({
          taskType: 'task2',
          question:
            (questions[1].questionText as string) ||
            (questions[1].instruction as string) ||
            'IELTS Academic Writing Task 2',
          essay,
          wordCount: countWords(essay),
        });
      }
    }

    if (tasksToEvaluate.length === 0 && answers['writing']) {
      const essay = answers['writing'];
      tasksToEvaluate.push({
        taskType: 'task2',
        question:
          assignment.section.description || 'IELTS Academic Writing Task 2',
        essay,
        wordCount: countWords(essay),
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

  private async submitSpeakingWithAi(
    assignment: AssignmentWithSection,
    persistedAnswers: Record<string, unknown>,
    studentId: string,
    targetStatus: AssignmentStatus = AssignmentStatus.SUBMITTED,
  ) {
    const questions =
      (assignment.section.questions as QuestionItem[] | null) || [];

    const speakingParts = (
      questions.length > 0 ? questions.slice(0, 3) : []
    ).map((question, index) => {
      const partNumber = index + 1;

      const prompt =
        question.instruction ||
        question.questionText ||
        assignment.section.description ||
        `IELTS Speaking Part ${partNumber}`;

      const answerByQuestionId =
        typeof persistedAnswers[question.id] === 'string'
          ? String(persistedAnswers[question.id]).trim()
          : '';
      const answerByDefaultId =
        typeof persistedAnswers[`s${partNumber}`] === 'string'
          ? String(persistedAnswers[`s${partNumber}`]).trim()
          : '';
      const answerByLegacy =
        partNumber === 1
          ? typeof persistedAnswers.speakingAudioUrl === 'string'
            ? String(persistedAnswers.speakingAudioUrl).trim()
            : typeof persistedAnswers.audioUrl === 'string'
              ? String(persistedAnswers.audioUrl).trim()
              : ''
          : '';

      const audioUrl =
        answerByQuestionId || answerByDefaultId || answerByLegacy;

      return {
        partNumber,
        questionId: question.id,
        prompt,
        audioUrl,
      };
    });

    if (speakingParts.length === 0) {
      const fallbackAudioUrl =
        typeof persistedAnswers.speakingAudioUrl === 'string'
          ? String(persistedAnswers.speakingAudioUrl).trim()
          : typeof persistedAnswers.audioUrl === 'string'
            ? String(persistedAnswers.audioUrl).trim()
            : typeof persistedAnswers.s1 === 'string'
              ? String(persistedAnswers.s1).trim()
              : '';

      speakingParts.push({
        partNumber: 1,
        questionId: 's1',
        prompt: assignment.section.description || 'IELTS Speaking prompt',
        audioUrl: fallbackAudioUrl,
      });
    }

    const evaluableParts = speakingParts.filter(
      (part) => part.audioUrl.length > 0,
    );
    if (evaluableParts.length === 0) {
      throw new BadRequestException(
        'Speaking audio URL is required for at least one part',
      );
    }

    if (speakingParts.length === 3 && evaluableParts.length < 3) {
      throw new BadRequestException(
        'Please upload recordings for all 3 speaking parts before submitting',
      );
    }

    const evaluatedParts: Array<{
      partNumber: number;
      questionId: string;
      prompt: string;
      audioUrl: string;
      transcription: string;
      evaluation: unknown;
      bandScore: number;
    }> = [];

    for (const part of evaluableParts) {
      const partDurationKey = `${part.questionId}__durationSeconds`;
      const partDurationRaw =
        persistedAnswers[partDurationKey] ??
        persistedAnswers.audioDurationSeconds;
      const parsedDuration = Number(partDurationRaw);
      const audioDurationSeconds =
        Number.isFinite(parsedDuration) && parsedDuration > 0
          ? parsedDuration
          : undefined;

      let transcription = '';
      try {
        transcription = await this.aiService.transcribeAudioFromUrl(
          part.audioUrl,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const normalized = message.toLowerCase();

        if (
          normalized.includes('no_speech_detected') ||
          normalized.includes('empty text') ||
          normalized.includes('transcription is empty')
        ) {
          throw new BadRequestException(
            `No clear speech was detected in Part ${part.partNumber}. Please record Part ${part.partNumber} again and speak clearly.`,
          );
        }

        if (normalized.includes('audio file not found')) {
          throw new BadRequestException(
            `Recording for Part ${part.partNumber} was not found. Please upload that part again.`,
          );
        }

        this.logger.error(
          `Speaking transcription failed for assignment ${assignment.id}, part ${part.partNumber}: ${message}`,
        );
        throw new ServiceUnavailableException(
          'Speaking transcription service is temporarily unavailable. Please try again in a moment.',
        );
      }

      let speakingEvaluation: Awaited<
        ReturnType<AiService['evaluateSpeakingSection']>
      >;
      try {
        speakingEvaluation = await this.aiService.evaluateSpeakingSection({
          prompt: part.prompt,
          transcription,
          audioDurationSeconds,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Speaking evaluation failed for assignment ${assignment.id}, part ${part.partNumber}: ${message}`,
        );
        throw new ServiceUnavailableException(
          'Speaking evaluation service is temporarily unavailable. Please try again in a moment.',
        );
      }

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

    const persisted = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.examAssignment.updateMany({
        where: {
          id: assignment.id,
          status: { not: AssignmentStatus.SUBMITTED },
        },
        data: {
          status: targetStatus,
          answers: persistedAnswers as Prisma.InputJsonValue,
          score: overallBand,
        },
      });

      if (claimed.count === 0) {
        return { alreadySubmitted: true as const };
      }

      const result = await tx.examResult.create({
        data: {
          studentId,
          sectionId: assignment.sectionId,
          score: overallBand,
          totalScore: 9,
          bandScore: overallBand,
          answers: persistedAnswers as Prisma.InputJsonValue,
          feedback: {
            parts: evaluatedParts,
            summary: {
              evaluatedParts: evaluatedParts.length,
              overallBand,
            },
          } as unknown as Prisma.InputJsonValue,
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

    this.eventEmitter.emit(
      'exam.submitted',
      new ExamSubmittedEvent(
        assignment.id,
        studentId,
        assignment.sectionId,
        assignment.section.type,
        overallBand,
        result.id,
      ),
    );

    return {
      message: 'Exam submitted successfully',
      assignmentId: assignment.id,
      status: 'SUBMITTED',
      resultId: result.id,
      score: overallBand,
      totalScore: 9,
      bandScore: overallBand,
      note: `Speaking section graded with AI evaluation across ${evaluatedParts.length} part(s).`,
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

    await tx.fullMockSession.update({
      where: { id: fullMockSessionId },
      data: {
        status: FullMockStatus.IN_PROGRESS,
        breakEndsAt: null,
        currentSequence:
          nextAssignment.fullMockSequence ?? session.currentSequence,
      },
    });

    return {
      nextAssignmentId: nextAssignment.id,
      breakEndsAt: null,
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
