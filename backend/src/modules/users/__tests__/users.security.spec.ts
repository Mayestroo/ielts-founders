import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from '../users.service';

describe('UsersService security boundaries', () => {
  it('blocks student self-role escalation', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'student-1',
          role: Role.STUDENT,
          centerId: 'center-1',
        }),
        update: jest.fn(),
      },
    } as any;

    const service = new UsersService(prisma);

    await expect(
      service.update(
        'student-1',
        { role: Role.SUPER_ADMIN },
        'student-1',
        Role.STUDENT,
        'center-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('blocks center admin from updating another center admin', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-2',
          role: Role.CENTER_ADMIN,
          centerId: 'center-1',
        }),
        update: jest.fn(),
      },
    } as any;

    const service = new UsersService(prisma);

    await expect(
      service.update(
        'admin-2',
        { firstName: 'Tampered' },
        'admin-1',
        Role.CENTER_ADMIN,
        'center-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
