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
import { CreateAssignmentDto } from '../exams/dto/create-assignment.dto';
import { CreateFullMockDto } from '../exams/dto/create-full-mock.dto';
import { PrismaService } from '../prisma/prisma.service';
import { ResponseCacheService } from '../redis';
import { SessionService } from '../session/session.service';

const ASSIGNMENTS_GROUPED_CACHE_PREFIX = 'cache:assignments:grouped:v1:';
const ASSIGNMENTS_GROUPED_TTL_SECONDS = 20;
const STUDENT_ASSIGNMENTS_CACHE_PREFIX = 'cache:assignments:student:v1:';
const STUDENT_ASSIGNMENTS_TTL_SECONDS = 20;

// Free assignment limits per section type
// These determine how many tests are auto-assigned as FREE
const SECTION_ASSIGNMENT_LIMITS: Record<ExamSectionType, number> = {
  [ExamSectionType.READING]: 2, // 1 complete + 1 split into 3 parts = 4 items
  [ExamSectionType.LISTENING]: 2, // 1 complete + 1 split into 4 parts = 5 items
  [ExamSectionType.WRITING]: 2, // 1 complete + 1 split into 2 tasks = 3 items
};

const AUTO_ASSIGN_SECTION_TYPES: ExamSectionType[] = [
  ExamSectionType.LISTENING,
  ExamSectionType.READING,
  ExamSectionType.WRITING,
];

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
  fullMockOnly?: boolean;
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
    private responseCache: ResponseCacheService,
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

    const assignment = await this.prisma.examAssignment.create({
      data: { studentId, sectionId },
      include: {
        section: true,
        student: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
      },
    });

    await this.invalidateAssignmentReadCaches();
    return assignment;
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
      select: {
        id: true,
        sectionId: true,
        status: true,
        fullMockSessionId: true,
      },
    });

    const sectionsAlreadyInOfflineFlow = existingAssignments.some(
      (assignment) => assignment.fullMockSessionId,
    );

    if (sectionsAlreadyInOfflineFlow) {
      throw new BadRequestException(
        'One or more sections are already linked to an offline exam',
      );
    }

    const sectionsAlreadyStarted = existingAssignments.some(
      (assignment) => assignment.status !== AssignmentStatus.ASSIGNED,
    );

    if (sectionsAlreadyStarted) {
      throw new BadRequestException(
        'One or more selected sections are already started or submitted',
      );
    }

    const existingBySectionId = new Map(
      existingAssignments.map((assignment) => [
        assignment.sectionId,
        assignment,
      ]),
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.fullMockSession.create({
        data: {
          studentId,
          centerId: student.centerId ?? centerId,
          status: FullMockStatus.ASSIGNED,
          currentSequence: 1,
        },
      });

      const orderedSections = [
        { sectionId: listeningSectionId, sequence: 1 },
        { sectionId: readingSectionId, sequence: 2 },
        { sectionId: writingSectionId, sequence: 3 },
      ] as const;

      const assignmentsToCreate = orderedSections
        .filter(({ sectionId }) => !existingBySectionId.has(sectionId))
        .map(({ sectionId, sequence }) => ({
          studentId,
          sectionId,
          fullMockSessionId: session.id,
          fullMockSequence: sequence,
        }));

      if (assignmentsToCreate.length > 0) {
        await tx.examAssignment.createMany({
          data: assignmentsToCreate,
        });
      }

      const assignmentsToUpdate: Array<{
        assignmentId: string;
        sequence: 1 | 2 | 3;
      }> = [];

      for (const { sectionId, sequence } of orderedSections) {
        const existingAssignment = existingBySectionId.get(sectionId);
        if (!existingAssignment) {
          continue;
        }

        assignmentsToUpdate.push({
          assignmentId: existingAssignment.id,
          sequence,
        });
      }

      if (assignmentsToUpdate.length > 0) {
        await Promise.all(
          assignmentsToUpdate.map(({ assignmentId, sequence }) =>
            tx.examAssignment.update({
              where: { id: assignmentId },
              data: {
                fullMockSessionId: session.id,
                fullMockSequence: sequence,
              },
            }),
          ),
        );
      }

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

    await this.invalidateAssignmentReadCaches();
    return result;
  }

  async createBulkFullMock(
    dto: {
      studentIds: string[];
      listeningSectionId: string;
      readingSectionId: string;
      writingSectionId: string;
    },
    assignerId: string,
    centerId: string,
  ) {
    const {
      studentIds,
      listeningSectionId,
      readingSectionId,
      writingSectionId,
    } = dto;

    // Validate sections once upfront
    const sectionIds = [listeningSectionId, readingSectionId, writingSectionId];
    const sections = await this.prisma.examSection.findMany({
      where: { id: { in: sectionIds } },
      select: { id: true, type: true, title: true, centerId: true },
    });

    if (sections.length !== sectionIds.length) {
      throw new BadRequestException('One or more sections not found');
    }

    const sectionById = new Map(sections.map((s) => [s.id, s]));
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

    // Process each student individually, collecting results
    const results: Array<{
      studentId: string;
      studentName: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const studentId of studentIds) {
      try {
        await this.createFullMock(
          { studentId, listeningSectionId, readingSectionId, writingSectionId },
          assignerId,
          centerId,
        );
        // Get student name for the response
        const student = await this.prisma.user.findUnique({
          where: { id: studentId },
          select: { firstName: true, lastName: true, username: true },
        });
        const studentName = student?.firstName
          ? `${student.firstName} ${student.lastName || ''}`.trim()
          : student?.username || studentId;

        results.push({ studentId, studentName, success: true });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Unknown error';
        // Get student name even on failure
        const student = await this.prisma.user.findUnique({
          where: { id: studentId },
          select: { firstName: true, lastName: true, username: true },
        });
        const studentName = student?.firstName
          ? `${student.firstName} ${student.lastName || ''}`.trim()
          : student?.username || studentId;

        results.push({
          studentId,
          studentName,
          success: false,
          error: errorMessage,
        });
      }
    }

    return {
      results,
      successCount: results.filter((r) => r.success).length,
      errorCount: results.filter((r) => !r.success).length,
    };
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
    const search = query.search?.trim() || '';

    const cacheKey = `${ASSIGNMENTS_GROUPED_CACHE_PREFIX}role:${requesterRole}:center:${requesterCenterId || 'all'}:skip:${skip}:take:${take}:search:${encodeURIComponent(search.toLowerCase())}:section:${query.sectionType || 'ALL'}:fmo:${query.fullMockOnly ? '1' : '0'}`;
    const cached = await this.responseCache.getJson<{
      groups: unknown[];
      total: number;
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    const studentWhere: Prisma.UserWhereInput = {
      role: Role.STUDENT,
    };

    if (
      (requesterRole === Role.CENTER_ADMIN || requesterRole === Role.TEACHER) &&
      requesterCenterId
    ) {
      studentWhere.centerId = requesterCenterId;
    }

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

    if (query.fullMockOnly) {
      assignmentWhere.fullMockSessionId = { not: null };
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
      const emptyPayload = { groups: [], total };
      await this.responseCache.setJson(
        cacheKey,
        emptyPayload,
        ASSIGNMENTS_GROUPED_TTL_SECONDS,
      );
      return emptyPayload;
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
            ...(query.fullMockOnly ? { fullMockSessionId: { not: null } } : {}),
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
            ${
              query.fullMockOnly
                ? Prisma.sql`AND ea."fullMockSessionId" IS NOT NULL`
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

    const payload = { groups, total };
    await this.responseCache.setJson(
      cacheKey,
      payload,
      ASSIGNMENTS_GROUPED_TTL_SECONDS,
    );
    return payload;
  }

  async getStudentAssignments(
    studentId: string,
    requesterId: string,
    requesterRole: Role,
    requesterCenterId: string | null,
    fullMockOnly = false,
  ) {
    if (requesterRole === Role.STUDENT && requesterId !== studentId) {
      throw new ForbiddenException('You can only view your own assignments');
    }

    if (requesterRole === Role.STUDENT && requesterId === studentId) {
      await this.ensureStarterAssignmentsForStudent(studentId);
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

    const where: Prisma.ExamAssignmentWhereInput = { studentId };
    if (fullMockOnly) {
      where.fullMockSessionId = { not: null };
    }

    const cacheKey =
      `${STUDENT_ASSIGNMENTS_CACHE_PREFIX}student:${studentId}:viewer:${requesterRole}:` +
      `viewerCenter:${requesterCenterId || 'all'}:fmo:${fullMockOnly ? '1' : '0'}`;
    const cached = await this.responseCache.getJson<unknown[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const assignments = await this.prisma.examAssignment.findMany({
      where,
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
            passages: true,
            questions: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const sanitizedAssignments = assignments.map((assignment) => ({
      ...assignment,
      section: this.sanitizeSectionForAssignmentList(assignment.section),
    }));

    await this.responseCache.setJson(
      cacheKey,
      sanitizedAssignments,
      STUDENT_ASSIGNMENTS_TTL_SECONDS,
    );

    return sanitizedAssignments;
  }

  private async ensureStarterAssignmentsForStudent(studentId: string) {
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, role: true, centerId: true },
    });

    if (!student || student.role !== Role.STUDENT || !student.centerId) {
      return;
    }

    const [existingAssignments, centerSections] = await Promise.all([
      this.prisma.examAssignment.findMany({
        where: {
          studentId,
          section: {
            type: { in: AUTO_ASSIGN_SECTION_TYPES },
          },
        },
        select: {
          sectionId: true,
          fullMockSessionId: true,
          section: {
            select: {
              type: true,
            },
          },
        },
      }),
      this.prisma.examSection.findMany({
        where: {
          centerId: student.centerId,
          type: { in: AUTO_ASSIGN_SECTION_TYPES },
        },
        select: {
          id: true,
          type: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    if (centerSections.length === 0) {
      return;
    }

    const assignedSectionIds = new Set(
      existingAssignments.map((assignment) => assignment.sectionId),
    );

    const currentCounts: Record<ExamSectionType, number> = {
      [ExamSectionType.LISTENING]: 0,
      [ExamSectionType.READING]: 0,
      [ExamSectionType.WRITING]: 0,
    };

    existingAssignments.forEach((assignment) => {
      if (assignment.fullMockSessionId) {
        return;
      }

      currentCounts[assignment.section.type] += 1;
    });

    const createData: Prisma.ExamAssignmentCreateManyInput[] = [];

    AUTO_ASSIGN_SECTION_TYPES.forEach((sectionType) => {
      // Use section-specific limits from configuration
      const limit = SECTION_ASSIGNMENT_LIMITS[sectionType];

      let remainingSlots = limit - currentCounts[sectionType];
      if (remainingSlots <= 0) {
        return;
      }

      const sectionCandidates = centerSections.filter(
        (section) =>
          section.type === sectionType && !assignedSectionIds.has(section.id),
      );

      sectionCandidates.forEach((section) => {
        if (remainingSlots <= 0) {
          return;
        }

        assignedSectionIds.add(section.id);
        createData.push({
          studentId,
          sectionId: section.id,
          status: AssignmentStatus.ASSIGNED,
        });
        remainingSlots -= 1;
      });
    });

    if (createData.length === 0) {
      return;
    }

    await this.prisma.examAssignment.createMany({
      data: createData,
      skipDuplicates: true,
    });

    await this.invalidateAssignmentReadCaches();
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

    const isSelfStudyAssignment = !assignment.fullMockSessionId;

    if (assignment.status === AssignmentStatus.SUBMITTED) {
      if (!isSelfStudyAssignment) {
        throw new BadRequestException('This exam has already been submitted');
      }

      const restartedAt = new Date();
      const restartedEndTime = new Date(
        restartedAt.getTime() + assignment.section.duration * 60 * 1000,
      );

      const restartedAssignment = await this.prisma.examAssignment.update({
        where: { id: assignmentId },
        data: {
          status: AssignmentStatus.IN_PROGRESS,
          startTime: restartedAt,
          endTime: restartedEndTime,
          answers: {},
          highlights: {},
          score: 0,
        },
        include: { section: true },
      });

      try {
        await this.sessionService.deleteSession(assignmentId);
      } catch {
        this.logger.warn(
          `Unable to clear stale Redis session while restarting assignment ${assignmentId}`,
        );
      }

      await this.ensureRedisSession(
        restartedAssignment.id,
        restartedAssignment.studentId,
        restartedAssignment.startTime!,
        restartedAssignment.endTime!,
        restartedAssignment.section.duration,
      );

      await this.invalidateAssignmentReadCaches();

      return {
        ...restartedAssignment,
        section: this.sanitizeSectionForStudent(restartedAssignment.section),
        startTime: restartedAssignment.startTime!,
        endTime: restartedAssignment.endTime!,
        remainingTime: restartedAssignment.section.duration * 60,
      };
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

      // If the exam has expired and it's a self-study assignment, restart it
      // (same logic as SUBMITTED self-study). This prevents the frontend from
      // getting stale data with remainingTime=0, which would cause an
      // infinite timer-expire -> auto-submit -> restart loop.
      const isExpired = existingEndTime.getTime() < Date.now();
      if (isExpired && isSelfStudyAssignment) {
        const restartedAt = new Date();
        const restartedEndTime = new Date(
          restartedAt.getTime() + assignment.section.duration * 60 * 1000,
        );

        const restartedAssignment = await this.prisma.examAssignment.update({
          where: { id: assignmentId },
          data: {
            status: AssignmentStatus.IN_PROGRESS,
            startTime: restartedAt,
            endTime: restartedEndTime,
            answers: {},
            highlights: {},
            score: 0,
          },
          include: { section: true },
        });

        try {
          await this.sessionService.deleteSession(assignmentId);
        } catch {
          this.logger.warn(
            `Unable to clear stale Redis session while restarting expired assignment ${assignmentId}`,
          );
        }

        await this.ensureRedisSession(
          restartedAssignment.id,
          restartedAssignment.studentId,
          restartedAssignment.startTime!,
          restartedAssignment.endTime!,
          restartedAssignment.section.duration,
        );

        await this.invalidateAssignmentReadCaches();

        return {
          ...restartedAssignment,
          section: this.sanitizeSectionForStudent(restartedAssignment.section),
          startTime: restartedAssignment.startTime!,
          endTime: restartedAssignment.endTime!,
          remainingTime: restartedAssignment.section.duration * 60,
        };
      }

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

    const reassigned = await this.prisma.examAssignment.update({
      where: { id: assignmentId },
      data: {
        status: AssignmentStatus.ASSIGNED,
        answers: {},
        score: 0,
        startTime: null,
        endTime: null,
      },
    });

    await this.invalidateAssignmentReadCaches();
    return reassigned;
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

    const deleted = await this.prisma.examAssignment.delete({
      where: { id: assignmentId },
    });

    await this.invalidateAssignmentReadCaches();
    return deleted;
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

    await this.invalidateAssignmentReadCaches();
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

  private async invalidateAssignmentReadCaches() {
    await this.responseCache.delByPrefixes([
      ASSIGNMENTS_GROUPED_CACHE_PREFIX,
      STUDENT_ASSIGNMENTS_CACHE_PREFIX,
      'cache:dashboard:stats:v1:',
      'cache:results:list:v1:',
      'cache:results:student:v1:',
    ]);
  }

  private sanitizeSectionForAssignmentList<T extends Record<string, unknown>>(
    section: T,
  ): T {
    if (!section) {
      return section;
    }

    const sanitized = this.sanitizeSectionForStudent(section);
    const compactSection = { ...sanitized } as Record<string, unknown>;

    if (Array.isArray(compactSection.passages)) {
      compactSection.passages = (compactSection.passages as unknown[]).map(
        (passage: unknown) => {
          if (!passage || typeof passage !== 'object') {
            return passage;
          }

          const p = passage as Record<string, unknown>;
          return {
            id: p.id,
            title: p.title,
          };
        },
      );
    }

    if (Array.isArray(compactSection.questions)) {
      compactSection.questions = (compactSection.questions as unknown[]).map(
        (question: unknown) => {
          if (!question || typeof question !== 'object') {
            return question;
          }

          const q = question as Record<string, unknown>;
          return {
            id: q.id,
            passageId: q.passageId,
            questionText: q.questionText,
            points: q.points,
          };
        },
      );
    }

    return compactSection as T;
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

  private sanitizeSectionForStudent<T extends Record<string, unknown>>(
    section: T,
  ): T {
    if (!section || !Array.isArray(section.questions)) {
      return section;
    }

    const sanitizedQuestions = (section.questions as unknown[]).map(
      (question: unknown) => {
        if (!question || typeof question !== 'object') {
          return question;
        }

        const q = question as Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { correctAnswer, correctAnswers, ...safeQuestion } = q;
        return safeQuestion;
      },
    );

    return {
      ...section,
      questions: sanitizedQuestions,
    };
  }
}
