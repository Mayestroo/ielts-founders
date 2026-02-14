import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AssignmentService } from '../assignment.service';

describe('AssignmentService authorization boundaries', () => {
  it('blocks center admin from reassigning another center assignment', async () => {
    const prisma = {
      examAssignment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'assignment-1',
          student: { centerId: 'center-2' },
        }),
      },
    } as any;

    const sessionService = {
      deleteSession: jest.fn(),
    } as any;

    const service = new AssignmentService(prisma, sessionService);

    await expect(
      service.reassign('assignment-1', Role.CENTER_ADMIN, 'center-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(sessionService.deleteSession).not.toHaveBeenCalled();
  });

  it('blocks teacher from reading assignment details of another center', async () => {
    const prisma = {
      examAssignment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'assignment-2',
          studentId: 'student-2',
          section: { id: 'section-1', questions: [] },
          student: {
            id: 'student-2',
            username: 'student',
            firstName: 'S',
            lastName: 'Two',
            centerId: 'center-2',
          },
        }),
      },
    } as any;

    const sessionService = {
      deleteSession: jest.fn(),
    } as any;

    const service = new AssignmentService(prisma, sessionService);

    await expect(
      service.findById('assignment-2', 'teacher-1', Role.TEACHER, 'center-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
