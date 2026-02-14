import { AssignmentStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExamSessionService } from '../exam-session.service';
import { SubmissionService } from '../submission.service';

describe('Failure mode simulations (runtime)', () => {
  const createExamSessionService = () => {
    const prisma = {
      examAssignment: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    } as any;

    const sessionService = {
      getSession: jest.fn(),
      createSession: jest.fn(),
      updateAnswers: jest.fn(),
      syncAnswersAtomic: jest.fn(),
      refreshExamLock: jest.fn(),
      acquireExamLock: jest.fn(),
      mergeAnswers: jest.fn(
        (server: Record<string, unknown>, client: Record<string, unknown>) => ({
          ...server,
          ...client,
        }),
      ),
    } as any;

    const service = new ExamSessionService(prisma, sessionService);
    return { service, prisma, sessionService };
  };

  it('simulates Redis outage: sync falls back to DB persistence', async () => {
    const { service, prisma, sessionService } = createExamSessionService();

    sessionService.refreshExamLock.mockResolvedValue(true);
    sessionService.syncAnswersAtomic.mockRejectedValue(new Error('Redis down'));
    prisma.examAssignment.findUnique.mockResolvedValue({
      studentId: 'student-1',
      status: AssignmentStatus.IN_PROGRESS,
      endTime: new Date(Date.now() + 15 * 60 * 1000),
      answers: { q1: 'A' },
      highlights: [],
    });
    prisma.examAssignment.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.syncAnswers(
      'assignment-1',
      'student-1',
      { q2: 'B' },
      [],
      7,
      'tab-1',
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        degraded: true,
        newVersion: 8,
      }),
    );

    expect(prisma.examAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'assignment-1',
          status: AssignmentStatus.IN_PROGRESS,
        },
        data: expect.objectContaining({
          answers: { q1: 'A', q2: 'B' },
        }),
      }),
    );
  });

  it('simulates 2s DB latency spike: heartbeat remains available but slow', async () => {
    const { service, prisma, sessionService } = createExamSessionService();

    sessionService.getSession.mockRejectedValue(new Error('Redis down'));
    prisma.examAssignment.findUnique.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              studentId: 'student-2',
              status: AssignmentStatus.IN_PROGRESS,
              endTime: new Date(Date.now() + 10 * 60 * 1000),
            });
          }, 2000);
        }),
    );

    const startedAt = Date.now();
    const result = await service.heartbeat(
      'assignment-2',
      'student-2',
      'tab-1',
    );
    const elapsedMs = Date.now() - startedAt;

    expect(result).toEqual(
      expect.objectContaining({
        active: true,
        degraded: true,
      }),
    );
    expect(elapsedMs).toBeGreaterThanOrEqual(1900);
  });

  it('simulates node restart/redis lock loss: duplicate submit stays idempotent', async () => {
    const prisma = {
      examAssignment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'assignment-3',
          studentId: 'student-3',
          status: AssignmentStatus.SUBMITTED,
          section: {
            id: 'section-1',
            type: 'READING',
            questions: [],
          },
        }),
      },
    } as any;

    const scoringService = {
      calculateSectionScore: jest.fn(),
      convertToBandScore: jest.fn(),
    } as any;

    const sessionService = {
      refreshExamLock: jest.fn().mockResolvedValue(true),
      acquireSubmitLock: jest
        .fn()
        .mockRejectedValue(new Error('Redis unavailable')),
      releaseSubmitLock: jest.fn(),
      markSubmitted: jest.fn(),
    } as any;

    const eventEmitter = {
      emit: jest.fn(),
    } as unknown as EventEmitter2;

    const service = new SubmissionService(
      prisma,
      scoringService,
      sessionService,
      eventEmitter,
    );

    const result = await service.submitAnswers(
      'assignment-3',
      { answers: { q1: 'A' }, tabId: 'tab-1' },
      'student-3',
    );

    expect(result).toEqual({ message: 'Already submitted', idempotent: true });
    expect(sessionService.releaseSubmitLock).not.toHaveBeenCalled();
  });
});
