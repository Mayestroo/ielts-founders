import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ResponseCacheService } from '../redis';
import { CreateExamSectionDto } from '../exams/dto/create-exam-section.dto';
import { UpdateExamSectionDto } from '../exams/dto/update-exam-section.dto';

@Injectable()
export class ExamSectionService {
  constructor(
    private prisma: PrismaService,
    private responseCache: ResponseCacheService,
  ) {}

  private buildScopedWhere(userRole: Role, centerId: string | null) {
    if (userRole === Role.TEACHER || userRole === Role.CENTER_ADMIN) {
      if (!centerId) {
        throw new ForbiddenException('Center context is required');
      }
      return { centerId } satisfies Prisma.ExamSectionWhereInput;
    }

    return {} satisfies Prisma.ExamSectionWhereInput;
  }

  private validateSpeakingStructure(
    type: string | undefined,
    questions: unknown,
  ): void {
    if (type !== 'SPEAKING') {
      return;
    }

    if (!Array.isArray(questions) || questions.length !== 3) {
      throw new BadRequestException(
        'Speaking sections must contain exactly 3 parts/questions',
      );
    }
  }

  async create(
    createSectionDto: CreateExamSectionDto,
    teacherId: string,
    centerId: string,
  ) {
    this.validateSpeakingStructure(
      createSectionDto.type,
      createSectionDto.questions,
    );

    const section = await this.prisma.examSection.create({
      data: {
        ...createSectionDto,
        questions: createSectionDto.questions as Prisma.InputJsonValue,
        passages: createSectionDto.passages as Prisma.InputJsonValue,
        teacherId,
        centerId,
      },
      include: {
        teacher: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
      },
    });

    await this.invalidateSectionReadCaches();
    return section;
  }

  async findAll(userRole: Role, centerId: string | null) {
    const where = this.buildScopedWhere(userRole, centerId);

    return this.prisma.examSection.findMany({
      where,
      select: {
        id: true,
        title: true,
        type: true,
        description: true,
        duration: true,
        audioUrl: true,
        teacherId: true,
        centerId: true,
        createdAt: true,
        updatedAt: true,
        teacher: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
        center: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOptions(userRole: Role, centerId: string | null) {
    const where = this.buildScopedWhere(userRole, centerId);

    return this.prisma.examSection.findMany({
      where,
      select: {
        id: true,
        title: true,
        type: true,
        duration: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(
    id: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ) {
    const section = await this.prisma.examSection.findUnique({
      where: { id },
      include: {
        teacher: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
        center: { select: { id: true, name: true } },
      },
    });

    if (!section) {
      throw new NotFoundException('Exam section not found');
    }

    if (
      requesterRole === Role.TEACHER ||
      requesterRole === Role.CENTER_ADMIN ||
      requesterRole === Role.STUDENT
    ) {
      if (!requesterCenterId || section.centerId !== requesterCenterId) {
        throw new ForbiddenException('Access denied for another center');
      }
    }

    return section;
  }

  async delete(
    id: string,
    userId: string,
    userRole: Role,
    requesterCenterId: string | null,
  ) {
    const section = await this.findById(id, userRole, requesterCenterId);

    if (userRole === Role.TEACHER && section.teacherId !== userId) {
      throw new ForbiddenException('You can only delete your own sections');
    }

    const [assignmentCount, resultCount] = await this.prisma.$transaction([
      this.prisma.examAssignment.count({ where: { sectionId: id } }),
      this.prisma.examResult.count({ where: { sectionId: id } }),
    ]);

    if (assignmentCount > 0 || resultCount > 0) {
      throw new ForbiddenException(
        'Cannot delete section with historical attempts/results',
      );
    }

    await this.prisma.examSection.delete({ where: { id } });
    await this.invalidateSectionReadCaches();
    return { message: 'Section deleted successfully' };
  }

  async update(
    id: string,
    updateSectionDto: UpdateExamSectionDto,
    userId: string,
    userRole: Role,
    requesterCenterId: string | null,
  ) {
    const section = await this.findById(id, userRole, requesterCenterId);

    this.validateSpeakingStructure(
      updateSectionDto.type ?? section.type,
      updateSectionDto.questions,
    );

    if (userRole === Role.TEACHER && section.teacherId !== userId) {
      throw new ForbiddenException('You can only update your own sections');
    }

    const { centerId, ...rest } = updateSectionDto;
    if (
      centerId &&
      userRole !== Role.SUPER_ADMIN &&
      centerId !== section.centerId
    ) {
      throw new ForbiddenException('You cannot change section center');
    }

    const updatedSection = await this.prisma.examSection.update({
      where: { id },
      data: {
        ...rest,
        ...(userRole === Role.SUPER_ADMIN && centerId ? { centerId } : {}),
        questions: updateSectionDto.questions as Prisma.InputJsonValue,
        passages: updateSectionDto.passages as Prisma.InputJsonValue,
      },
    });

    await this.invalidateSectionReadCaches();
    return updatedSection;
  }

  private async invalidateSectionReadCaches() {
    await this.responseCache.delByPrefixes([
      'cache:dashboard:stats:v1:',
      'cache:assignments:grouped:v1:',
      'cache:assignments:student:v1:',
      'cache:results:list:v1:',
      'cache:results:student:v1:',
    ]);
  }
}
