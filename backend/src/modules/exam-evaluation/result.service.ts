import {
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
          writingSubmission: true,
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
        writingSubmission: true,
      },
      orderBy: { submittedAt: 'desc' },
    });

    await this.responseCache.setJson(
      cacheKey,
      results,
      STUDENT_RESULTS_TTL_SECONDS,
    );
    return results;
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

  private async invalidateResultReadCaches() {
    await this.responseCache.delByPrefixes([
      RESULTS_LIST_CACHE_PREFIX,
      STUDENT_RESULTS_CACHE_PREFIX,
      'cache:dashboard:stats:v1:',
      'cache:assignments:grouped:v1:',
    ]);
  }
}
