import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // Role hierarchy validation
  private canCreateRole(creatorRole: Role, targetRole: Role): boolean {
    const roleHierarchy: Record<Role, Role[]> = {
      [Role.SUPER_ADMIN]: [Role.CENTER_ADMIN],
      [Role.CENTER_ADMIN]: [Role.TEACHER, Role.STUDENT],
      [Role.TEACHER]: [],
      [Role.STUDENT]: [],
    };
    return roleHierarchy[creatorRole]?.includes(targetRole);
  }

  async create(createUserDto: CreateUserDto, creatorId: string, creatorRole: Role, creatorCenterId: string | null) {
    // Validate role creation permissions
    if (!this.canCreateRole(creatorRole, createUserDto.role)) {
      throw new ForbiddenException(`You cannot create users with role ${createUserDto.role}`);
    }

    // Check if username already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { username: createUserDto.username },
    });
    if (existingUser) {
      throw new BadRequestException('Username already exists');
    }

    // CENTER_ADMIN can only create users for their own center
    let centerId: string | null | undefined = createUserDto.centerId;
    if (creatorRole === Role.CENTER_ADMIN) {
      centerId = creatorCenterId;
    }

    // Validate center exists if provided
    if (centerId) {
      const center = await this.prisma.center.findUnique({
        where: { id: centerId },
      });
      if (!center) {
        throw new BadRequestException('Center not found');
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
        centerId,
      },
      include: { center: true },
    });

    const { password: _, ...result } = user;
    return result;
  }

  async findAll(userRole: Role, userCenterId: string | null, skip?: number, take?: number) {
    let where = {};

    if (userRole === Role.CENTER_ADMIN) {
      // CENTER_ADMIN sees only users in their center
      where = { centerId: userCenterId };
    } else if (userRole === Role.TEACHER) {
      // TEACHER sees only students in their center
      where = { centerId: userCenterId, role: Role.STUDENT };
    } else if (userRole !== Role.SUPER_ADMIN) {
      // Other roles can't list users
      throw new ForbiddenException('You do not have permission to list users');
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { center: true },
        orderBy: { createdAt: 'desc' },
        skip: skip ? Number(skip) : undefined,
        take: take ? Number(take) : undefined,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users: users.map(({ password: _, ...user }) => user),
      total,
    };
  }

  async findOne(id: string, requesterId: string, requesterRole: Role, requesterCenterId: string | null) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { center: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check permissions
    if (requesterRole === Role.SUPER_ADMIN) {
      // Can view anyone
    } else if (requesterRole === Role.CENTER_ADMIN) {
      // Can only view users in their center
      if (user.centerId !== requesterCenterId) {
        throw new ForbiddenException('You cannot view this user');
      }
    } else if (requesterRole === Role.TEACHER) {
      // Can only view students in their center
      if (user.centerId !== requesterCenterId || user.role !== Role.STUDENT) {
        throw new ForbiddenException('You cannot view this user');
      }
    } else if (requesterId !== id) {
      // Students can only view themselves
      throw new ForbiddenException('You cannot view this user');
    }

    const { password: _, ...result } = user;
    return result;
  }

  async update(id: string, updateUserDto: UpdateUserDto, requesterId: string, requesterRole: Role, requesterCenterId: string | null) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check permissions
    if (requesterRole === Role.SUPER_ADMIN) {
      // Can update anyone except role to SUPER_ADMIN
    } else if (requesterRole === Role.CENTER_ADMIN) {
      if (user.centerId !== requesterCenterId) {
        throw new ForbiddenException('You cannot update this user');
      }
      // Cannot change role to CENTER_ADMIN or SUPER_ADMIN
      if (updateUserDto.role && (updateUserDto.role === Role.SUPER_ADMIN || updateUserDto.role === Role.CENTER_ADMIN)) {
        throw new ForbiddenException('You cannot assign this role');
      }
    } else if (requesterId !== id) {
      throw new ForbiddenException('You cannot update this user');
    }

    // Hash password if provided
    if (updateUserDto.password) {
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: updateUserDto,
      include: { center: true },
    });

    const { password: _, ...result } = updatedUser;
    return result;
  }

  async remove(id: string, requesterId: string, requesterRole: Role, requesterCenterId: string | null) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check permissions
    if (requesterRole === Role.SUPER_ADMIN) {
      // Can delete anyone except themselves
      if (requesterId === id) {
        throw new ForbiddenException('You cannot delete yourself');
      }
    } else if (requesterRole === Role.CENTER_ADMIN) {
      if (user.centerId !== requesterCenterId || user.role === Role.CENTER_ADMIN) {
        throw new ForbiddenException('You cannot delete this user');
      }
    } else {
      throw new ForbiddenException('You cannot delete users');
    }

    await this.prisma.user.delete({ where: { id } });
    return { message: 'User deleted successfully' };
  }
}
