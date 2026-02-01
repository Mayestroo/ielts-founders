import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus, FullMockStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
import { CreateAssignmentDto } from '../exams/dto/create-assignment.dto';
import { CreateFullMockDto } from '../exams/dto/create-full-mock.dto';

export interface AssignmentWithSection {
  id: string;
  studentId: string;
  sectionId: string;
  fullMockSessionId?: string | null;
  fullMockSequence?: number | null;
  section: {
    id: string;
    title: string;
    type: string;
    description: string | null;
    duration: number;
    audioUrl?: string | null;
  };
  student: {
    id: string;
    username: string;
    firstName: string | null;
    lastName: string | null;
    centerId: string;
  };
  status: AssignmentStatus;
  startTime: Date | null;
  endTime: Date | null;
  answers: unknown;
  score: number | null;
}

export interface BreakStatus {
  status: 'BREAK';
  assignmentId: string;
  breakEndsAt: string;
  message: string;
}

export type StartExamResponse =
  | {
      id: string;
      studentId: string;
      sectionId: string;
      section: { duration: number };
      status: AssignmentStatus;
      startTime: Date;
      endTime: Date;
      remainingTime: number;
    }
  | BreakStatus;

@Injectable()
export class AssignmentService {
  constructor(
    private prisma: PrismaService,
    private sessionService: SessionService,
  ) {}

  async create(
    createAssignmentDto: CreateAssignmentDto,
    assignerId: string,
    centerId: string,
  ) {
    const { studentId, sectionId } = createAssignmentDto;

    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
    });
    if (!student || student.role !== Role.STUDENT) {
      throw new BadRequestException('Invalid student');
    }
    if (student.centerId !== centerId) {
      throw new ForbiddenException('Student must belong to your center');
    }

    const section = await this.prisma.examSection.findUnique({
      where: { id: sectionId },
    });
    if (!section) {
      throw new BadRequestException('Section not found');
    }

    const existingAssignment = await this.prisma.examAssignment.findUnique({
      where: { studentId_sectionId: { studentId, sectionId } },
    });
    if (existingAssignment) {
      throw new BadRequestException('Section already assigned to this student');
    }

    return this.prisma.examAssignment.create({
      data: { studentId, sectionId },
      include: {
        section: true,
        student: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async createFullMock(
    createFullMockDto: CreateFullMockDto,
    assignerId: string,
    centerId: string,
  ) {
    const {
      studentId,
      listeningSectionId,
      readingSectionId,
      writingSectionId,
      breakMinutes,
    } = createFullMockDto;

    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
    });
    if (!student || student.role !== Role.STUDENT) {
      throw new BadRequestException('Invalid student');
    }
    if (student.centerId !== centerId) {
      throw new ForbiddenException('Student must belong to your center');
    }

    const sectionIds = [listeningSectionId, readingSectionId, writingSectionId];
    const sections = await this.prisma.examSection.findMany({
      where: { id: { in: sectionIds } },
      select: { id: true, type: true, title: true },
    });

    if (sections.length !== sectionIds.length) {
      throw new BadRequestException('One or more sections not found');
    }

    const sectionById = new Map(sections.map((section) => [section.id, section]));
    const expectedTypes = new Map([
      [listeningSectionId, 'LISTENING'],
      [readingSectionId, 'READING'],
      [writingSectionId, 'WRITING'],
    ] as const);

    for (const [sectionId, expectedType] of expectedTypes.entries()) {
      const section = sectionById.get(sectionId);
      if (!section || section.type !== expectedType) {
        throw new BadRequestException(
          `Section ${sectionId} must be of type ${expectedType}`,
        );
      }
    }

    const existingAssignments = await this.prisma.examAssignment.findMany({
      where: {
        studentId,
        sectionId: { in: sectionIds },
      },
      select: { id: true, sectionId: true },
    });

    if (existingAssignments.length > 0) {
      throw new BadRequestException(
        'One or more sections already assigned to this student',
      );
    }

    const sessionBreakMinutes = Math.max(1, breakMinutes ?? 2);

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.fullMockSession.create({
        data: {
          studentId,
          centerId: student.centerId ?? centerId,
          breakMinutes: sessionBreakMinutes,
          status: FullMockStatus.ASSIGNED,
          currentSequence: 1,
        },
      });

      await tx.examAssignment.createMany({
        data: [
          {
            studentId,
            sectionId: listeningSectionId,
            fullMockSessionId: session.id,
            fullMockSequence: 1,
          },
          {
            studentId,
            sectionId: readingSectionId,
            fullMockSessionId: session.id,
            fullMockSequence: 2,
          },
          {
            studentId,
            sectionId: writingSectionId,
            fullMockSessionId: session.id,
            fullMockSequence: 3,
          },
        ],
      });

      const assignments = await tx.examAssignment.findMany({
        where: { fullMockSessionId: session.id },
        include: {
          section: true,
          student: {
            select: { id: true, username: true, firstName: true, lastName: true },
          },
        },
        orderBy: { fullMockSequence: 'asc' },
      });

      return { session, assignments };
    });
  }

  async findAll(
    requesterRole: Role,
    requesterCenterId: string | null,
    skip?: number,
    take?: number,
  ) {
    if (requesterRole === Role.STUDENT) {
      throw new ForbiddenException('Students cannot list all assignments');
    }

    let where: Prisma.ExamAssignmentWhereInput = {};
    if (requesterRole === Role.CENTER_ADMIN || requesterRole === Role.TEACHER) {
      where = {
        student: { centerId: requesterCenterId },
      };
    }

    const [assignments, total] = await Promise.all([
      this.prisma.examAssignment.findMany({
        where,
        include: {
          section: {
            select: {
              id: true,
              title: true,
              type: true,
              description: true,
              duration: true,
            },
          },
          student: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: skip ? Number(skip) : undefined,
        take: take ? Number(take) : undefined,
      }),
      this.prisma.examAssignment.count({ where }),
    ]);

    return { assignments, total };
  }

  async getStudentAssignments(
    studentId: string,
    requesterId: string,
    requesterRole: Role,
  ) {
    if (requesterRole === Role.STUDENT && requesterId !== studentId) {
      throw new ForbiddenException('You can only view your own assignments');
    }

    return this.prisma.examAssignment.findMany({
      where: { studentId },
      include: {
        section: {
          select: {
            id: true,
            title: true,
            type: true,
            description: true,
            duration: true,
            audioUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(
    assignmentId: string,
    requesterId: string,
    requesterRole: Role,
  ): Promise<AssignmentWithSection> {
    const assignment = await this.prisma.examAssignment.findUnique({
      where: { id: assignmentId },
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
      },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (
      requesterRole === Role.STUDENT &&
      assignment.studentId !== requesterId
    ) {
      throw new ForbiddenException('You can only view your own assignments');
    }

    return assignment as AssignmentWithSection;
  }

  async startExam(
    assignmentId: string,
    studentId: string,
  ): Promise<StartExamResponse> {
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
      throw new BadRequestException('This exam has already been submitted');
    }

    if (assignment.fullMockSessionId && assignment.fullMockSequence) {
      const session = await this.prisma.fullMockSession.findUnique({
        where: { id: assignment.fullMockSessionId },
      });

      if (session?.status === FullMockStatus.COMPLETED) {
        throw new BadRequestException('Full mock already completed');
      }

      if (session?.breakEndsAt) {
        const now = new Date();
        if (now < session.breakEndsAt) {
          return {
            status: 'BREAK',
            assignmentId: assignment.id,
            breakEndsAt: session.breakEndsAt.toISOString(),
            message: 'Break in progress. Please wait before starting.',
          };
        }
      }

      if (session && session.currentSequence !== assignment.fullMockSequence) {
        throw new BadRequestException(
          'This section is locked until the previous section is submitted',
        );
      }

      if (session) {
        await this.prisma.fullMockSession.update({
          where: { id: session.id },
          data: {
            status: FullMockStatus.IN_PROGRESS,
            breakEndsAt: null,
            currentSequence: assignment.fullMockSequence,
          },
        });
      }
    }

    if (
      assignment.status === AssignmentStatus.IN_PROGRESS &&
      assignment.startTime
    ) {
      return {
        ...assignment,
        startTime: assignment.startTime,
        endTime:
          assignment.endTime ??
          new Date(
            assignment.startTime.getTime() +
              assignment.section.duration * 60 * 1000,
          ),
        remainingTime: this.calculateRemainingTime(
          assignment.startTime,
          assignment.section.duration,
        ),
      };
    }

    const startTime = new Date();
    const endTime = new Date(
      startTime.getTime() + assignment.section.duration * 60 * 1000,
    );

    const updatedAssignment = await this.prisma.examAssignment.update({
      where: { id: assignmentId },
      data: {
        status: AssignmentStatus.IN_PROGRESS,
        startTime,
        endTime,
      },
      include: {
        section: true,
      },
    });

    return {
      ...updatedAssignment,
      startTime: updatedAssignment.startTime!,
      endTime: updatedAssignment.endTime!,
      remainingTime: assignment.section.duration * 60,
    };
  }

  async reassign(assignmentId: string): Promise<{
    id: string;
    status: AssignmentStatus;
    answers: unknown;
    score: number | null;
    startTime: Date | null;
    endTime: Date | null;
  }> {
    const assignment = await this.prisma.examAssignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    await this.sessionService.deleteSession(assignmentId);

    return this.prisma.examAssignment.update({
      where: { id: assignmentId },
      data: {
        status: AssignmentStatus.ASSIGNED,
        answers: {},
        score: 0,
        startTime: null,
        endTime: null,
      },
    });
  }

  async delete(assignmentId: string): Promise<{ id: string }> {
    const assignment = await this.prisma.examAssignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    return this.prisma.examAssignment.delete({
      where: { id: assignmentId },
    });
  }

  async markAsSubmitted(
    assignmentId: string,
    answers: unknown,
    score: number,
  ): Promise<void> {
    await this.prisma.examAssignment.update({
      where: { id: assignmentId },
      data: {
        status: AssignmentStatus.SUBMITTED,
        answers: answers as Prisma.InputJsonValue,
        score,
      },
    });
  }

  async updateAnswers(assignmentId: string, answers: unknown): Promise<void> {
    await this.prisma.examAssignment.update({
      where: { id: assignmentId },
      data: { answers: answers as Prisma.InputJsonValue },
    });
  }

  async saveHighlights(
    assignmentId: string,
    highlights: unknown,
    studentId: string,
  ) {
    const assignment = await this.prisma.examAssignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (assignment.studentId !== studentId) {
      throw new ForbiddenException('Access denied');
    }

    return this.prisma.examAssignment.update({
      where: { id: assignmentId },
      data: { highlights: highlights as Prisma.InputJsonValue },
    });
  }

  private calculateRemainingTime(
    startTime: Date,
    durationMinutes: number,
  ): number {
    const now = new Date();
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
    const remaining = Math.max(
      0,
      Math.floor((endTime.getTime() - now.getTime()) / 1000),
    );
    return remaining;
  }
}
