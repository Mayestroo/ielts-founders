import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCenterDto, UpdateCenterDto } from './dto/center.dto';

@Injectable()
export class CentersService {
  constructor(private prisma: PrismaService) {}

  private sanitizeCenter(center: any) {
    if (!center) {
      return center;
    }

    const { loginPassword, ...safeCenter } = center;
    return {
      ...safeCenter,
      hasLoginPassword: Boolean(loginPassword),
    };
  }

  async create(createCenterDto: CreateCenterDto) {
    const existing = await this.prisma.center.findUnique({
      where: { name: createCenterDto.name },
    });

    if (existing) {
      throw new BadRequestException('Center with this name already exists');
    }

    const hashedLoginPassword = createCenterDto.loginPassword
      ? await bcrypt.hash(createCenterDto.loginPassword, 10)
      : undefined;

    const { loginPassword: _ignoredPassword, ...safeCenterData } =
      createCenterDto;

    const center = await this.prisma.center.create({
      data: {
        ...safeCenterData,
        ...(hashedLoginPassword !== undefined
          ? { loginPassword: hashedLoginPassword }
          : {}),
      },
    });

    return this.sanitizeCenter(center);
  }

  async findAll() {
    const centers = await this.prisma.center.findMany({
      select: {
        id: true,
        name: true,
        logo: true,
        loginPassword: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { users: true, examSections: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return centers.map((center) => this.sanitizeCenter(center));
  }

  async findOne(
    id: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ) {
    if (requesterRole !== Role.SUPER_ADMIN) {
      if (!requesterCenterId || requesterCenterId !== id) {
        throw new ForbiddenException('You can only view your own center');
      }
    }

    const center = await this.prisma.center.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        logo: true,
        loginPassword: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { users: true, examSections: true },
        },
      },
    });

    if (!center) {
      throw new NotFoundException('Center not found');
    }

    return this.sanitizeCenter(center);
  }

  async update(id: string, updateCenterDto: UpdateCenterDto) {
    const center = await this.prisma.center.findUnique({ where: { id } });

    if (!center) {
      throw new NotFoundException('Center not found');
    }

    let hashedLoginPassword: string | undefined;
    if (typeof updateCenterDto.loginPassword === 'string') {
      hashedLoginPassword = await bcrypt.hash(
        updateCenterDto.loginPassword,
        10,
      );
    }

    const updated = await this.prisma.center.update({
      where: { id },
      data: {
        ...updateCenterDto,
        ...(hashedLoginPassword !== undefined
          ? { loginPassword: hashedLoginPassword }
          : {}),
      },
    });

    return this.sanitizeCenter(updated);
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
