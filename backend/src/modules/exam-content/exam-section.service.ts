import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExamSectionDto } from '../exams/dto/create-exam-section.dto';
import { UpdateExamSectionDto } from '../exams/dto/update-exam-section.dto';

@Injectable()
export class ExamSectionService {
  constructor(private prisma: PrismaService) {}

  async create(
    createSectionDto: CreateExamSectionDto,
    teacherId: string,
    centerId: string,
  ) {
    return this.prisma.examSection.create({
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
  }

  async findAll(userRole: Role, centerId: string | null, teacherId?: string) {
    let where: Prisma.ExamSectionWhereInput = {};

    if (userRole === Role.TEACHER && centerId) {
      where = { centerId };
    } else if (userRole === Role.CENTER_ADMIN && centerId) {
      where = { centerId };
    }

    return this.prisma.examSection.findMany({
      where,
      include: {
        teacher: {
          select: { id: true, username: true, firstName: true, lastName: true },
        },
        center: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
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

    return section;
  }

  async delete(id: string, userId: string, userRole: Role) {
    const section = await this.findById(id);

    if (userRole === Role.TEACHER && section.teacherId !== userId) {
      throw new ForbiddenException('You can only delete your own sections');
    }

    await this.prisma.examSection.delete({ where: { id } });
    return { message: 'Section deleted successfully' };
  }

  async update(
    id: string,
    updateSectionDto: UpdateExamSectionDto,
    userId: string,
    userRole: Role,
  ) {
    const section = await this.findById(id);

    if (userRole === Role.TEACHER && section.teacherId !== userId) {
      throw new ForbiddenException('You can only update your own sections');
    }

    return this.prisma.examSection.update({
      where: { id },
      data: {
        ...updateSectionDto,
        questions: updateSectionDto.questions as Prisma.InputJsonValue,
        passages: updateSectionDto.passages as Prisma.InputJsonValue,
      },
    });
  }
}
