import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

type TariffLabel = 'PREMIUM' | 'GOLD' | 'FREE';
type SanitizableCenter = { loginPassword?: unknown } & Record<string, unknown>;
type SanitizableUser = {
  password?: unknown;
  center?: SanitizableCenter | null;
} & Record<string, unknown>;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private sanitizeCenter<T extends SanitizableCenter | null | undefined>(
    center: T,
  ) {
    if (!center) {
      return center;
    }

    const { loginPassword, ...safeCenter } = center;
    return {
      ...safeCenter,
      hasLoginPassword: Boolean(loginPassword),
    };
  }

  private sanitizeUser<T extends SanitizableUser | null | undefined>(user: T) {
    if (!user) {
      return user;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, center, ...safeUser } = user;
    return {
      ...safeUser,
      ...(center !== undefined ? { center: this.sanitizeCenter(center) } : {}),
    };
  }

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

  async create(
    createUserDto: CreateUserDto,
    creatorId: string,
    creatorRole: Role,
    creatorCenterId: string | null,
  ) {
    if (createUserDto.premiumActive && createUserDto.goldActive) {
      throw new BadRequestException(
        'A user cannot have both Gold and Premium access at the same time',
      );
    }

    if (
      createUserDto.role !== Role.STUDENT &&
      (createUserDto.premiumActive || createUserDto.goldActive)
    ) {
      throw new BadRequestException(
        'Gold or Premium access can only be set for students',
      );
    }

    // Validate role creation permissions
    if (!this.canCreateRole(creatorRole, createUserDto.role)) {
      throw new ForbiddenException(
        `You cannot create users with role ${createUserDto.role}`,
      );
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

    const { sessionReferralSource, ...restCreateUserData } = createUserDto;

    const user = await this.prisma.user.create({
      data: {
        ...restCreateUserData,
        sessionReferralSource:
          createUserDto.role === Role.STUDENT ? null : sessionReferralSource,
        password: hashedPassword,
        centerId,
      },
      include: { center: true },
    });

    return this.sanitizeUser(user);
  }

  async findAll(
    userRole: Role,
    userCenterId: string | null,
    skip?: number,
    take?: number,
    search?: string,
    roleFilter?: Role,
    centerFilter?: string,
  ) {
    let where: Prisma.UserWhereInput = {};

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

    // Apply additional filters
    if (roleFilter) {
      where.role = roleFilter;
    }

    if (centerFilter && userRole === Role.SUPER_ADMIN) {
      where.centerId = centerFilter;
    }

    if (search) {
      const trimmedSearch = search.trim();
      const parts = trimmedSearch.split(/\s+/);

      if (parts.length > 1) {
        // Handle "First Last" search
        where.OR = [
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
          // Also allowing "LastName FirstName" if needed, but sticking to logical assumption for now or single string match fallback
        ];
      } else {
        where.OR = [
          { firstName: { startsWith: trimmedSearch, mode: 'insensitive' } },
          { lastName: { startsWith: trimmedSearch, mode: 'insensitive' } },
          { username: { startsWith: trimmedSearch, mode: 'insensitive' } },
        ];
      }
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
      users: users.map((user) => this.sanitizeUser(user)),
      total,
    };
  }

  async findStudents(
    requesterRole: Role,
    requesterCenterId: string | null,
    skip?: number,
    take?: number,
    search?: string,
  ) {
    if (
      requesterRole !== Role.SUPER_ADMIN &&
      requesterRole !== Role.CENTER_ADMIN &&
      requesterRole !== Role.TEACHER
    ) {
      throw new ForbiddenException(
        'You do not have permission to list students',
      );
    }

    if (
      (requesterRole === Role.CENTER_ADMIN || requesterRole === Role.TEACHER) &&
      !requesterCenterId
    ) {
      throw new ForbiddenException('Center context is required');
    }

    const where: Prisma.UserWhereInput = {
      role: Role.STUDENT,
    };

    if (
      (requesterRole === Role.CENTER_ADMIN || requesterRole === Role.TEACHER) &&
      requesterCenterId
    ) {
      where.centerId = requesterCenterId;
    }

    if (search?.trim()) {
      const normalized = search.trim();
      const parts = normalized.split(/\s+/);

      if (parts.length > 1) {
        where.OR = [
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
          { username: { startsWith: normalized, mode: 'insensitive' } },
        ];
      } else {
        where.OR = [
          { firstName: { startsWith: normalized, mode: 'insensitive' } },
          { lastName: { startsWith: normalized, mode: 'insensitive' } },
          { username: { startsWith: normalized, mode: 'insensitive' } },
        ];
      }
    }

    const skipValue = Number(skip ?? 0);
    const takeValue = Number(take ?? 100);

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
        },
        orderBy: [{ firstName: 'asc' }, { username: 'asc' }],
        skip: Number.isFinite(skipValue) && skipValue > 0 ? skipValue : 0,
        take:
          Number.isFinite(takeValue) && takeValue > 0
            ? Math.min(Math.floor(takeValue), 1000)
            : 100,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total };
  }

  async getTariffReport(requesterRole: Role, requesterCenterId: string | null) {
    if (
      requesterRole !== Role.SUPER_ADMIN &&
      requesterRole !== Role.CENTER_ADMIN &&
      requesterRole !== Role.TEACHER
    ) {
      throw new ForbiddenException(
        'You do not have permission to access reports',
      );
    }

    if (requesterRole !== Role.SUPER_ADMIN && !requesterCenterId) {
      throw new ForbiddenException('Center context is required');
    }

    const where: Prisma.UserWhereInput = {
      role: Role.STUDENT,
      ...(requesterRole === Role.SUPER_ADMIN
        ? {}
        : { centerId: requesterCenterId }),
    };

    const students = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        sessionReferralSource: true,
        premiumActive: true,
        goldActive: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return students.map((student) => {
      const tariff: TariffLabel = student.premiumActive
        ? 'PREMIUM'
        : student.goldActive
          ? 'GOLD'
          : 'FREE';

      return {
        userId: student.id,
        user:
          `${student.firstName || ''} ${student.lastName || ''}`.trim() ||
          student.username,
        username: student.username,
        referral: student.sessionReferralSource,
        tariff,
        tariffActivatedAt:
          tariff === 'FREE' ? null : student.updatedAt.toISOString(),
      };
    });
  }

  async findOne(
    id: string,
    requesterId: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ) {
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

    return this.sanitizeUser(user);
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    requesterId: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ) {
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
      if (user.role === Role.SUPER_ADMIN) {
        throw new ForbiddenException('You cannot update this user');
      }
      if (user.role === Role.CENTER_ADMIN && requesterId !== id) {
        throw new ForbiddenException('You cannot update another center admin');
      }
      // Cannot change role to CENTER_ADMIN or SUPER_ADMIN
      if (
        updateUserDto.role &&
        (updateUserDto.role === Role.SUPER_ADMIN ||
          updateUserDto.role === Role.CENTER_ADMIN)
      ) {
        throw new ForbiddenException('You cannot assign this role');
      }
    } else if (requesterId !== id) {
      throw new ForbiddenException('You cannot update this user');
    }

    if (requesterRole === Role.STUDENT || requesterRole === Role.TEACHER) {
      if (
        updateUserDto.role ||
        updateUserDto.centerId ||
        updateUserDto.premiumActive !== undefined ||
        updateUserDto.goldActive !== undefined
      ) {
        throw new ForbiddenException(
          'You cannot change role, center, or tariff access',
        );
      }
    }

    if (
      (updateUserDto.premiumActive !== undefined ||
        updateUserDto.goldActive !== undefined) &&
      user.role !== Role.STUDENT
    ) {
      throw new ForbiddenException(
        'Gold or Premium access can only be changed for students',
      );
    }

    if (updateUserDto.premiumActive && updateUserDto.goldActive) {
      throw new BadRequestException(
        'A user cannot have both Gold and Premium access at the same time',
      );
    }

    if (
      updateUserDto.premiumActive === true &&
      updateUserDto.goldActive === undefined
    ) {
      updateUserDto.goldActive = false;
    }

    if (
      updateUserDto.goldActive === true &&
      updateUserDto.premiumActive === undefined
    ) {
      updateUserDto.premiumActive = false;
    }

    if (
      requesterRole === Role.CENTER_ADMIN &&
      updateUserDto.centerId &&
      updateUserDto.centerId !== requesterCenterId
    ) {
      throw new ForbiddenException('You cannot move users to another center');
    }

    if (
      requesterRole !== Role.SUPER_ADMIN &&
      updateUserDto.role === Role.SUPER_ADMIN
    ) {
      throw new ForbiddenException('You cannot assign this role');
    }

    // Hash password if provided
    if (updateUserDto.password) {
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    const updateData: Prisma.UserUpdateInput = {
      ...updateUserDto,
    };

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: updateData,
      include: { center: true },
    });

    return this.sanitizeUser(updatedUser);
  }

  async remove(
    id: string,
    requesterId: string,
    requesterRole: Role,
    requesterCenterId: string | null,
  ) {
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
      if (
        user.centerId !== requesterCenterId ||
        user.role === Role.CENTER_ADMIN
      ) {
        throw new ForbiddenException('You cannot delete this user');
      }
    } else {
      throw new ForbiddenException('You cannot delete users');
    }

    await this.prisma.user.delete({ where: { id } });
    return { message: 'User deleted successfully' };
  }
}
