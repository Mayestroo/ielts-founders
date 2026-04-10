import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ResponseCacheService } from '../redis';

const RESULTS_LIST_CACHE_PREFIX = 'cache:results:list:v1:';
const STUDENT_RESULTS_CACHE_PREFIX = 'cache:results:student:v1:';
const RESULTS_LIST_TTL_SECONDS = 20;
const STUDENT_RESULTS_TTL_SECONDS = 20;

interface ManualSpeakingScoresInput {
  fluencyCoherence: number;
  lexicalResource: number;
  grammaticalRangeAccuracy: number;
  pronunciation: number;
  overallBand?: number;
  comment?: string;
}

interface ManualSpeakingPreparedData {
  overallBand: number;
  feedback: Prisma.InputJsonValue;
}

const clampHalfBand = (value: number): number => {
  const normalized = Number.isFinite(value) ? value : 0;
  const clamped = Math.min(9, Math.max(0, normalized));
  return Math.round(clamped * 2) / 2;
};

@Injectable()
export class ResultService {
  constructor(
    private prisma: PrismaService,
    private responseCache: ResponseCacheService,
  ) {}

  async findAll(
    requesterRole: Role,
    requesterCenterId: string | null,
    skip?: number,
    take?: number,
  ) {
    if (requesterRole === Role.STUDENT) {
      throw new ForbiddenException('Students cannot list all results');
    }

    let where: Prisma.ExamResultWhereInput = {};
    if (requesterRole === Role.CENTER_ADMIN || requesterRole === Role.TEACHER) {
      where = {
        student: { centerId: requesterCenterId },
      };
    }

    const skipValue = skip ? Number(skip) : 0;
    const takeValue = take ? Number(take) : 0;
    const cacheKey = `${RESULTS_LIST_CACHE_PREFIX}role:${requesterRole}:center:${requesterCenterId || 'all'}:skip:${skipValue}:take:${takeValue}`;
    const cached = await this.responseCache.getJson<{
      results: unknown[];
      total: number;
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    const [results, total] = await Promise.all([
      this.prisma.examResult.findMany({
        where,
        include: {
          section: {
            select: { id: true, title: true, type: true },
          },
          student: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
            },
          },
          // [PERF-FIX] Only fetch status fields in list view, avoids loading full task responses — see /performance-audit/
          writingSubmission: {
            select: {
              id: true,
              status: true,
              bandScore: true,
              completedAt: true,
            },
          },
        },
        orderBy: { submittedAt: 'desc' },
        skip: skip ? Number(skip) : undefined,
        take: take ? Number(take) : undefined,
      }),
      this.prisma.examResult.count({ where }),
    ]);

    const payload = { results, total };
    await this.responseCache.setJson(
      cacheKey,
      payload,
      RESULTS_LIST_TTL_SECONDS,
    );
    return payload;
  }

  async findById(
    id: string,
    requesterId: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ) {
    const result = await this.prisma.examResult.findUnique({
      where: { id },
      include: {
        section: true,
        student: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            centerId: true,
          },
        },
        writingSubmission: true,
      },
    });

    if (!result) {
      throw new NotFoundException('Result not found');
    }

    if (requesterRole === Role.STUDENT && result.studentId !== requesterId) {
      throw new ForbiddenException('You can only view your own results');
    }

    if (
      requesterRole === Role.STUDENT &&
      (await this.isOfflineResultHiddenForStudent(
        result.studentId,
        result.sectionId,
      ))
    ) {
      throw new ForbiddenException('Result is not available yet');
    }

    if (requesterRole === Role.TEACHER || requesterRole === Role.CENTER_ADMIN) {
      if (result.student.centerId !== requesterCenterId) {
        throw new ForbiddenException(
          'You can only view results from your center',
        );
      }
    }

    return result;
  }

  async getStudentResults(
    studentId: string,
    requesterId: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ) {
    if (requesterRole === Role.STUDENT && requesterId !== studentId) {
      throw new ForbiddenException('You can only view your own results');
    }

    if (requesterRole === Role.TEACHER || requesterRole === Role.CENTER_ADMIN) {
      const student = await this.prisma.user.findUnique({
        where: { id: studentId },
      });
      if (!student || student.centerId !== requesterCenterId) {
        throw new ForbiddenException(
          'You can only view results for students in your center',
        );
      }
    }

    const cacheKey = `${STUDENT_RESULTS_CACHE_PREFIX}student:${studentId}:viewer:${requesterRole}:viewerCenter:${requesterCenterId || 'all'}`;
    const cached = await this.responseCache.getJson<unknown[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const results = await this.prisma.examResult.findMany({
      where: { studentId },
      include: {
        section: {
          select: { id: true, title: true, type: true },
        },
        student: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
        // [PERF-FIX] Only fetch status fields in list view, avoids loading full task responses — see /performance-audit/
        writingSubmission: {
          select: {
            id: true,
            status: true,
            bandScore: true,
            completedAt: true,
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    const visibleResults =
      requesterRole === Role.STUDENT
        ? await this.filterHiddenOfflineResults(studentId, results)
        : results;

    await this.responseCache.setJson(
      cacheKey,
      visibleResults,
      STUDENT_RESULTS_TTL_SECONDS,
    );
    return visibleResults;
  }

  async updateFromAI(
    resultId: string,
    bandScore: number,
    feedback: unknown,
  ): Promise<void> {
    await this.prisma.examResult.update({
      where: { id: resultId },
      data: {
        score: bandScore,
        totalScore: 9,
        bandScore,
        feedback: feedback as Prisma.InputJsonValue,
      },
    });

    await this.invalidateResultReadCaches();
  }

  async updateWithAIEvaluation(
    resultId: string,
    evaluation: unknown,
    assignmentAnswers?: unknown,
  ): Promise<void> {
    const evalData = evaluation as { bandScore: number };

    await this.prisma.examResult.update({
      where: { id: resultId },
      data: {
        score: evalData.bandScore,
        totalScore: 9,
        bandScore: evalData.bandScore,
        feedback: evaluation as Prisma.InputJsonValue,
      },
    });

    if (assignmentAnswers) {
      const result = await this.prisma.examResult.findUnique({
        where: { id: resultId },
        select: { studentId: true, sectionId: true },
      });

      if (result) {
        const assignment = await this.prisma.examAssignment.findFirst({
          where: {
            studentId: result.studentId,
            sectionId: result.sectionId,
          },
        });

        if (assignment) {
          await this.prisma.examAssignment.update({
            where: { id: assignment.id },
            data: {
              answers: {
                ...((assignment.answers as Record<string, unknown>) || {}),
                _aiEvaluation: evaluation,
              } as Prisma.InputJsonValue,
            },
          });
        }
      }
    }

    await this.invalidateResultReadCaches();
  }

  private prepareManualSpeakingData(
    payload: ManualSpeakingScoresInput,
    graderId: string,
    existingFeedback: unknown,
  ): ManualSpeakingPreparedData {
    const scores = {
      fluency_coherence: clampHalfBand(payload.fluencyCoherence),
      lexical_resource: clampHalfBand(payload.lexicalResource),
      grammatical_range_accuracy: clampHalfBand(
        payload.grammaticalRangeAccuracy,
      ),
      pronunciation: clampHalfBand(payload.pronunciation),
    };

    const averageBand =
      (scores.fluency_coherence +
        scores.lexical_resource +
        scores.grammatical_range_accuracy +
        scores.pronunciation) /
      4;

    const overallBand = clampHalfBand(
      typeof payload.overallBand === 'number'
        ? payload.overallBand
        : averageBand,
    );

    const normalizedFeedback =
      existingFeedback && typeof existingFeedback === 'object'
        ? (existingFeedback as Record<string, unknown>)
        : {};

    const feedback = {
      ...normalizedFeedback,
      manualEvaluation: {
        isManual: true,
        gradedBy: graderId,
        gradedAt: new Date().toISOString(),
        overallBand,
        scores,
        comment: payload.comment?.trim() || null,
      },
    };

    return {
      overallBand,
      feedback: feedback as Prisma.InputJsonValue,
    };
  }

  async manualGradeSpeaking(
    resultId: string,
    payload: ManualSpeakingScoresInput,
    graderId: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ) {
    const result = await this.prisma.examResult.findUnique({
      where: { id: resultId },
      include: {
        section: {
          select: {
            id: true,
            type: true,
            centerId: true,
          },
        },
      },
    });

    if (!result) {
      throw new NotFoundException('Result not found');
    }

    if (result.section?.type !== 'SPEAKING') {
      throw new BadRequestException(
        'Manual speaking grading is only available for speaking sections',
      );
    }

    if (
      requesterRole !== Role.SUPER_ADMIN &&
      (!requesterCenterId || result.section.centerId !== requesterCenterId)
    ) {
      throw new ForbiddenException('Access denied for another center');
    }

    const prepared = this.prepareManualSpeakingData(
      payload,
      graderId,
      result.feedback,
    );

    const updatedResult = await this.prisma.examResult.update({
      where: { id: resultId },
      data: {
        score: prepared.overallBand,
        totalScore: 9,
        bandScore: prepared.overallBand,
        feedback: prepared.feedback,
      },
    });

    await this.invalidateResultReadCaches();

    return updatedResult;
  }

  async manualGradeSpeakingByStudent(
    studentId: string,
    payload: ManualSpeakingScoresInput,
    graderId: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ) {
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        role: true,
        centerId: true,
      },
    });

    if (!student || student.role !== Role.STUDENT) {
      throw new NotFoundException('Student not found');
    }

    if (
      requesterRole !== Role.SUPER_ADMIN &&
      (!requesterCenterId || student.centerId !== requesterCenterId)
    ) {
      throw new ForbiddenException('Access denied for another center');
    }

    const existingSpeakingResults = await this.prisma.examResult.findMany({
      where: {
        studentId,
        section: {
          type: 'SPEAKING',
        },
      },
      select: {
        id: true,
        answers: true,
      },
      orderBy: {
        submittedAt: 'desc',
      },
    });

    const existingSpeakingResult = existingSpeakingResults.find(
      (result) => !this.isStandaloneAttempt(result.answers),
    );

    if (existingSpeakingResult) {
      return this.manualGradeSpeaking(
        existingSpeakingResult.id,
        payload,
        graderId,
        requesterRole,
        requesterCenterId,
      );
    }

    const candidateSection = await this.prisma.examSection.findFirst({
      where: {
        type: 'SPEAKING',
        ...(student.centerId ? { centerId: student.centerId } : {}),
      },
      select: {
        id: true,
        centerId: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!candidateSection) {
      throw new BadRequestException(
        'No speaking section is available for this student center',
      );
    }

    if (
      requesterRole !== Role.SUPER_ADMIN &&
      (!requesterCenterId || candidateSection.centerId !== requesterCenterId)
    ) {
      throw new ForbiddenException('Access denied for another center');
    }

    const prepared = this.prepareManualSpeakingData(payload, graderId, null);

    const createdResult = await this.prisma.examResult.create({
      data: {
        studentId,
        sectionId: candidateSection.id,
        score: prepared.overallBand,
        totalScore: 9,
        bandScore: prepared.overallBand,
        answers: {
          _attemptMode: 'offline-manual',
        } as Prisma.InputJsonValue,
        feedback: prepared.feedback,
      },
    });

    await this.invalidateResultReadCaches();

    return createdResult;
  }

  private async invalidateResultReadCaches() {
    await this.responseCache.delByPrefixes([
      RESULTS_LIST_CACHE_PREFIX,
      STUDENT_RESULTS_CACHE_PREFIX,
      'cache:dashboard:stats:v1:',
      'cache:assignments:grouped:v1:',
    ]);
  }

  private async isOfflineResultHiddenForStudent(
    studentId: string,
    sectionId: string,
  ): Promise<boolean> {
    const assignment = await this.prisma.examAssignment.findFirst({
      where: {
        studentId,
        sectionId,
      },
      select: {
        fullMockSessionId: true,
        fullMockSession: {
          select: {
            resultsVisibleToStudent: true,
          },
        },
      },
    });

    if (!assignment?.fullMockSessionId) {
      return false;
    }

    return assignment.fullMockSession?.resultsVisibleToStudent !== true;
  }

  private async filterHiddenOfflineResults<T extends { sectionId: string }>(
    studentId: string,
    results: T[],
  ): Promise<T[]> {
    const assignments = await this.prisma.examAssignment.findMany({
      where: {
        studentId,
      },
      select: {
        sectionId: true,
        fullMockSessionId: true,
        fullMockSession: {
          select: {
            resultsVisibleToStudent: true,
          },
        },
      },
    });

    const sectionVisibility = new Map<string, boolean>();
    assignments.forEach((assignment) => {
      if (!assignment.fullMockSessionId) {
        sectionVisibility.set(assignment.sectionId, true);
        return;
      }

      sectionVisibility.set(
        assignment.sectionId,
        assignment.fullMockSession?.resultsVisibleToStudent === true,
      );
    });

    return results.filter(
      (result) => sectionVisibility.get(result.sectionId) !== false,
    );
  }

  private isStandaloneAttempt(answers: Prisma.JsonValue | null): boolean {
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return false;
    }

    const parsedAnswers = answers as Record<string, unknown>;
    const attemptMode =
      typeof parsedAnswers._attemptMode === 'string'
        ? parsedAnswers._attemptMode.trim().toLowerCase()
        : '';

    if (attemptMode === 'standalone') {
      return true;
    }

    return parsedAnswers._isStandalone === true;
  }
}
