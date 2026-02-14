import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentStatus,
  ExamSectionType,
  FullMockStatus,
  Prisma,
  Role,
} from '@prisma/client';
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

interface GroupedAssignmentsQuery {
  skip?: number;
  take?: number;
  search?: string;
  sectionType?: ExamSectionType;
}

interface AssignmentPreviewRow {
  id: string;
  studentId: string;
  status: AssignmentStatus;
  fullMockSessionId: string | null;
  createdAt: Date;
  sectionId: string;
  sectionTitle: string;
  sectionType: ExamSectionType;
  sectionDuration: number;
}

@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

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
      select: { id: true, centerId: true },
    });
    if (!section) {
      throw new BadRequestException('Section not found');
    }
    if (section.centerId !== centerId) {
      throw new ForbiddenException('Section must belong to your center');
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
      select: { id: true, type: true, title: true, centerId: true },
    });

    if (sections.length !== sectionIds.length) {
      throw new BadRequestException('One or more sections not found');
    }

    const sectionById = new Map(
      sections.map((section) => [section.id, section]),
    );
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
      if (section.centerId !== centerId) {
        throw new ForbiddenException(
          `Section ${sectionId} must belong to your center`,
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
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
            },
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

    if (
      (requesterRole === Role.CENTER_ADMIN || requesterRole === Role.TEACHER) &&
      !requesterCenterId
    ) {
      throw new ForbiddenException('Center context is required');
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

  async findGrouped(
    requesterRole: Role,
    requesterCenterId: string | null,
    query: GroupedAssignmentsQuery,
  ) {
    if (requesterRole === Role.STUDENT) {
      throw new ForbiddenException('Students cannot list all assignments');
    }

    if (
      (requesterRole === Role.CENTER_ADMIN || requesterRole === Role.TEACHER) &&
      !requesterCenterId
    ) {
      throw new ForbiddenException('Center context is required');
    }

    const skipValue = Number(query.skip ?? 0);
    const takeValue = Number(query.take ?? 10);
    const skip = Number.isFinite(skipValue) && skipValue > 0 ? skipValue : 0;
    const take =
      Number.isFinite(takeValue) && takeValue > 0
        ? Math.min(Math.floor(takeValue), 100)
        : 10;

    const studentWhere: Prisma.UserWhereInput = {
      role: Role.STUDENT,
    };

    if (
      (requesterRole === Role.CENTER_ADMIN || requesterRole === Role.TEACHER) &&
      requesterCenterId
    ) {
      studentWhere.centerId = requesterCenterId;
    }

    const search = query.search?.trim();
    if (search) {
      const parts = search.split(/\s+/);
      if (parts.length > 1) {
        studentWhere.OR = [
          {
            AND: [
              { firstName: { startsWith: parts[0], mode: 'insensitive' } },
              {
                lastName: {
                  startsWith: parts.slice(1).join(' '),
                  mode: 'insensitive',
                },
              },
            ],
          },
          { username: { startsWith: search, mode: 'insensitive' } },
        ];
      } else {
        studentWhere.OR = [
          { firstName: { startsWith: search, mode: 'insensitive' } },
          { lastName: { startsWith: search, mode: 'insensitive' } },
          { username: { startsWith: search, mode: 'insensitive' } },
        ];
      }
    }

    const assignmentWhere: Prisma.ExamAssignmentWhereInput = {
      student: studentWhere,
    };

    if (query.sectionType) {
      assignmentWhere.section = { type: query.sectionType };
    }

    const [groupRows, total] = await Promise.all([
      this.prisma.examAssignment.groupBy({
        by: ['studentId'],
        where: assignmentWhere,
        _max: { createdAt: true },
        orderBy: { _max: { createdAt: 'desc' } },
        skip,
        take,
      }),
      this.prisma.user.count({
        where: {
          ...studentWhere,
          assignments: {
            some: query.sectionType
              ? { section: { type: query.sectionType } }
              : {},
          },
        },
      }),
    ]);

    const studentIds = groupRows.map((row) => row.studentId);
    if (studentIds.length === 0) {
      return { groups: [], total };
    }

    const [students, statusRows, fullMockRows, previewRows] = await Promise.all(
      [
        this.prisma.user.findMany({
          where: { id: { in: studentIds } },
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
          },
        }),
        this.prisma.examAssignment.groupBy({
          by: ['studentId', 'status'],
          where: {
            studentId: { in: studentIds },
            ...(query.sectionType
              ? { section: { type: query.sectionType } }
              : {}),
          },
          _count: { _all: true },
        }),
        this.prisma.examAssignment.findMany({
          where: {
            studentId: { in: studentIds },
            fullMockSessionId: { not: null },
            ...(query.sectionType
              ? { section: { type: query.sectionType } }
              : {}),
          },
          select: {
            studentId: true,
          },
          distinct: ['studentId'],
        }),
        this.prisma.$queryRaw<AssignmentPreviewRow[]>(Prisma.sql`
        SELECT
          ranked."id",
          ranked."studentId",
          ranked."status",
          ranked."fullMockSessionId",
          ranked."createdAt",
          ranked."sectionId",
          ranked."sectionTitle",
          ranked."sectionType",
          ranked."sectionDuration"
        FROM (
          SELECT
            ea."id",
            ea."studentId",
            ea."status",
            ea."fullMockSessionId",
            ea."createdAt",
            es."id" AS "sectionId",
            es."title" AS "sectionTitle",
            es."type" AS "sectionType",
            es."duration" AS "sectionDuration",
            ROW_NUMBER() OVER (
              PARTITION BY ea."studentId"
              ORDER BY ea."createdAt" DESC, ea."id" DESC
            ) AS "rowNumber"
          FROM "ExamAssignment" ea
          INNER JOIN "ExamSection" es
            ON es."id" = ea."sectionId"
          WHERE ea."studentId" IN (${Prisma.join(studentIds)})
            ${
              query.sectionType
                ? Prisma.sql`AND es."type" = ${query.sectionType}`
                : Prisma.empty
            }
        ) ranked
        WHERE ranked."rowNumber" <= 3
        ORDER BY ranked."studentId", ranked."createdAt" DESC, ranked."id" DESC
      `),
      ],
    );

    const studentById = new Map(
      students.map((student) => [student.id, student]),
    );
    const hasFullMockSet = new Set(fullMockRows.map((row) => row.studentId));

    const summaryByStudent = new Map<
      string,
      {
        assigned: number;
        progress: number;
        submitted: number;
        total: number;
        hasFullMock: boolean;
        previewAssignments: {
          id: string;
          status: AssignmentStatus;
          fullMockSessionId: string | null;
          createdAt: string;
          section: {
            id: string;
            title: string;
            type: ExamSectionType;
            duration: number;
          };
        }[];
      }
    >();

    for (const statusRow of statusRows) {
      const current = summaryByStudent.get(statusRow.studentId) ?? {
        assigned: 0,
        progress: 0,
        submitted: 0,
        total: 0,
        hasFullMock: hasFullMockSet.has(statusRow.studentId),
        previewAssignments: [],
      };

      const count = statusRow._count._all;
      current.total += count;

      if (statusRow.status === AssignmentStatus.ASSIGNED) {
        current.assigned += count;
      } else if (statusRow.status === AssignmentStatus.IN_PROGRESS) {
        current.progress += count;
      } else if (statusRow.status === AssignmentStatus.SUBMITTED) {
        current.submitted += count;
      }

      summaryByStudent.set(statusRow.studentId, current);
    }

    for (const previewRow of previewRows) {
      const current = summaryByStudent.get(previewRow.studentId) ?? {
        assigned: 0,
        progress: 0,
        submitted: 0,
        total: 0,
        hasFullMock: hasFullMockSet.has(previewRow.studentId),
        previewAssignments: [],
      };

      current.previewAssignments.push({
        id: previewRow.id,
        status: previewRow.status,
        fullMockSessionId: previewRow.fullMockSessionId,
        createdAt: previewRow.createdAt.toISOString(),
        section: {
          id: previewRow.sectionId,
          title: previewRow.sectionTitle,
          type: previewRow.sectionType,
          duration: Number(previewRow.sectionDuration),
        },
      });

      summaryByStudent.set(previewRow.studentId, current);
    }

    const groups = groupRows
      .map((row) => {
        const student = studentById.get(row.studentId);
        const summary = summaryByStudent.get(row.studentId);

        if (!student || !summary) {
          return null;
        }

        return {
          student,
          latestDate:
            row._max.createdAt?.toISOString() ??
            summary.previewAssignments[0]?.createdAt ??
            new Date(0).toISOString(),
          hasFullMock: summary.hasFullMock,
          stats: {
            assigned: summary.assigned,
            progress: summary.progress,
            submitted: summary.submitted,
            total: summary.total,
          },
          previewAssignments: summary.previewAssignments,
        };
      })
      .filter((group): group is NonNullable<typeof group> => group !== null);

    return { groups, total };
  }

  async getStudentAssignments(
    studentId: string,
    requesterId: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ) {
    if (requesterRole === Role.STUDENT && requesterId !== studentId) {
      throw new ForbiddenException('You can only view your own assignments');
    }

    if (requesterRole === Role.TEACHER || requesterRole === Role.CENTER_ADMIN) {
      if (!requesterCenterId) {
        throw new ForbiddenException('Center context is required');
      }

      const student = await this.prisma.user.findUnique({
        where: { id: studentId },
        select: { centerId: true, role: true },
      });

      if (!student || student.role !== Role.STUDENT) {
        throw new NotFoundException('Student not found');
      }

      if (student.centerId !== requesterCenterId) {
        throw new ForbiddenException('Access denied for another center');
      }
    }

    return this.prisma.examAssignment.findMany({
      where: { studentId },
      select: {
        id: true,
        studentId: true,
        sectionId: true,
        status: true,
        startTime: true,
        endTime: true,
        score: true,
        fullMockSessionId: true,
        fullMockSequence: true,
        createdAt: true,
        updatedAt: true,
        section: {
          select: {
            id: true,
            title: true,
            type: true,
            duration: true,
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
    requesterCenterId: string | null,
  ): Promise<AssignmentWithSection> {
    if (requesterRole === Role.STUDENT) {
      const assignment = await this.prisma.examAssignment.findUnique({
        where: { id: assignmentId },
        include: {
          section: true,
        },
      });

      if (!assignment) {
        throw new NotFoundException('Assignment not found');
      }

      if (assignment.studentId !== requesterId) {
        throw new ForbiddenException('You can only view your own assignments');
      }

      return {
        ...assignment,
        section: this.sanitizeSectionForStudent(assignment.section),
      } as unknown as AssignmentWithSection;
    }

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

    if (requesterRole === Role.CENTER_ADMIN || requesterRole === Role.TEACHER) {
      if (!requesterCenterId) {
        throw new ForbiddenException('Center context is required');
      }

      if (assignment.student.centerId !== requesterCenterId) {
        throw new ForbiddenException('Access denied for another center');
      }
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
      const existingEndTime =
        assignment.endTime ??
        new Date(
          assignment.startTime.getTime() +
            assignment.section.duration * 60 * 1000,
        );
      await this.ensureRedisSession(
        assignment.id,
        assignment.studentId,
        assignment.startTime,
        existingEndTime,
        assignment.section.duration,
      );

      return {
        ...assignment,
        section: this.sanitizeSectionForStudent(assignment.section),
        startTime: assignment.startTime,
        endTime: existingEndTime,
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

    await this.ensureRedisSession(
      updatedAssignment.id,
      updatedAssignment.studentId,
      updatedAssignment.startTime!,
      updatedAssignment.endTime!,
      updatedAssignment.section.duration,
    );

    return {
      ...updatedAssignment,
      section: this.sanitizeSectionForStudent(updatedAssignment.section),
      startTime: updatedAssignment.startTime!,
      endTime: updatedAssignment.endTime!,
      remainingTime: assignment.section.duration * 60,
    };
  }

  async reassign(
    assignmentId: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ): Promise<{
    id: string;
    status: AssignmentStatus;
    answers: unknown;
    score: number | null;
    startTime: Date | null;
    endTime: Date | null;
  }> {
    const assignment = await this.prisma.examAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        student: { select: { centerId: true } },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (requesterRole === Role.CENTER_ADMIN || requesterRole === Role.TEACHER) {
      if (!requesterCenterId) {
        throw new ForbiddenException('Center context is required');
      }

      if (assignment.student.centerId !== requesterCenterId) {
        throw new ForbiddenException('Access denied for another center');
      }
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

  async delete(
    assignmentId: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ): Promise<{ id: string }> {
    const assignment = await this.prisma.examAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        student: { select: { centerId: true } },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (requesterRole === Role.CENTER_ADMIN || requesterRole === Role.TEACHER) {
      if (!requesterCenterId) {
        throw new ForbiddenException('Center context is required');
      }

      if (assignment.student.centerId !== requesterCenterId) {
        throw new ForbiddenException('Access denied for another center');
      }
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

  private async ensureRedisSession(
    assignmentId: string,
    studentId: string,
    startTime: Date,
    endTime: Date,
    durationMinutes: number,
  ): Promise<void> {
    try {
      const existingSession =
        await this.sessionService.getSession(assignmentId);
      if (existingSession) {
        return;
      }

      await this.sessionService.createSession(
        assignmentId,
        studentId,
        startTime,
        endTime,
        durationMinutes,
      );
    } catch {
      this.logger.warn(
        `Unable to initialize Redis exam session for assignment ${assignmentId}. Proceeding with DB state only.`,
      );
    }
  }

  private sanitizeSectionForStudent(section: any) {
    if (!section || !Array.isArray(section.questions)) {
      return section;
    }

    const sanitizedQuestions = section.questions.map((question: unknown) => {
      if (!question || typeof question !== 'object') {
        return question;
      }

      const q = question as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { correctAnswer, correctAnswers, ...safeQuestion } = q;
      return safeQuestion;
    });

    return {
      ...section,
      questions: sanitizedQuestions,
    };
  }
}
