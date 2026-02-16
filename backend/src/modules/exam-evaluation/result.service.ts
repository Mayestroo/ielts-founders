import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ResultService {
  constructor(private prisma: PrismaService) {}

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

    return { results, total };
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

    return this.prisma.examResult.findMany({
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
  }
}
