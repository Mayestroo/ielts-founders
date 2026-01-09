import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCenterDto, UpdateCenterDto } from './dto/center.dto';

@Injectable()
export class CentersService {
  constructor(private prisma: PrismaService) {}

  async create(createCenterDto: CreateCenterDto) {
    const existing = await this.prisma.center.findUnique({
      where: { name: createCenterDto.name },
    });

    if (existing) {
      throw new BadRequestException('Center with this name already exists');
    }

    return this.prisma.center.create({
      data: createCenterDto,
    });
  }

  async findAll() {
    return this.prisma.center.findMany({
      include: {
        _count: {
          select: { users: true, examSections: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const center = await this.prisma.center.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, examSections: true },
        },
      },
    });

    if (!center) {
      throw new NotFoundException('Center not found');
    }

    return center;
  }

  async update(id: string, updateCenterDto: UpdateCenterDto) {
    const center = await this.prisma.center.findUnique({ where: { id } });

    if (!center) {
      throw new NotFoundException('Center not found');
    }

    return this.prisma.center.update({
      where: { id },
      data: updateCenterDto,
    });
  }

  async remove(id: string) {
    const center = await this.prisma.center.findUnique({ where: { id } });

    if (!center) {
      throw new NotFoundException('Center not found');
    }

    await this.prisma.center.delete({ where: { id } });
    return { message: 'Center deleted successfully' };
  }
}
