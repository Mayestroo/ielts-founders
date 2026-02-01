import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SessionService } from '../session/session.service';
import { AssignmentService } from './assignment.service';

// Grace period in milliseconds (60 seconds)
const GRACE_PERIOD_MS = 60_000;

interface SessionData {
  studentId: string;
  status: 'ACTIVE' | 'SUBMITTED' | 'EXPIRED';
  endsAt: string;
  syncVersion: number;
  answers?: Record<string, unknown>;
  highlights?: unknown[];
}

@Injectable()
export class ExamSessionService {
  constructor(
    private prisma: PrismaService,
    private sessionService: SessionService,
    private assignmentService: AssignmentService,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {}

  async syncAnswers(
    assignmentId: string,
    studentId: string,
    answers: Record<string, unknown>,
    highlights: unknown[],
    syncVersion: number,
  ) {
    const assignment = await this.prisma.examAssignment.findUnique({
      where: { id: assignmentId },
      select: { studentId: true, status: true },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (assignment.studentId !== studentId) {
      throw new ForbiddenException('Not authorized');
    }

    if (assignment.status === AssignmentStatus.SUBMITTED) {
      throw new BadRequestException('Exam already submitted');
    }

    const result = await this.sessionService.updateAnswers(
      assignmentId,
      answers,
      highlights,
      syncVersion,
    );

    if (result.conflict) {
      return {
        success: false,
        message: 'Version conflict - please refresh session',
        serverVersion: result.newVersion,
        action: 'refresh',
      };
    }

    return {
      success: result.success,
      newVersion: result.newVersion,
      syncedAt: new Date().toISOString(),
    };
  }

  async heartbeat(assignmentId: string, studentId: string, tabId?: string) {
    const session = await this.sessionService.getSession(assignmentId);
    
    // Auto-recover session if missing but exam is valid
    if (!session) {
      const assignment = await this.prisma.examAssignment.findUnique({
        where: { id: assignmentId },
        include: { section: true },
      });

      if (!assignment) {
        return { active: false, reason: 'no_session' };
      }

      if (assignment.studentId !== studentId) {
        return { active: false, reason: 'wrong_student' };
      }

      if (assignment.status !== AssignmentStatus.IN_PROGRESS) {
        return { active: false, reason: 'no_session' };
      }

      if (!assignment.endTime) {
        return { active: false, reason: 'no_session' };
      }

      const now = new Date();
      const gracePeriodEnd = new Date(
        assignment.endTime.getTime() + GRACE_PERIOD_MS,
      );

      if (now > gracePeriodEnd) {
        return { active: false, reason: 'time_expired' };
      }

      // Recover session
      await this.sessionService.createSession(
        assignmentId,
        studentId,
        assignment.startTime!,
        assignment.endTime,
        assignment.section.duration,
      );
      
      // Retry heartbeat
      return this.heartbeat(assignmentId, studentId, tabId);
    }

    if (session.studentId !== studentId) {
      return { active: false, reason: 'wrong_student' };
    }

    if (session.status !== 'ACTIVE') {
      return { active: false, reason: session.status.toLowerCase() };
    }

    if (tabId) {
      const lockOk = await this.sessionService.refreshExamLock(
        assignmentId,
        tabId,
      );
      if (!lockOk) {
        const existingLock = await this.redis.get(`exam:lock:${assignmentId}`);
        console.warn(
          `[Heartbeat] Lock conflict for assignment ${assignmentId}. Current tab: ${tabId}, Holding tab: ${existingLock}`,
        );
        return { active: false, reason: 'another_tab' };
      }
    }

    const endsAt = new Date(session.endsAt);
    const now = new Date();
    const remainingMs = endsAt.getTime() - now.getTime();

    if (remainingMs <= 0) {
      return { active: false, reason: 'time_expired' };
    }

    return {
      active: true,
      remainingSeconds: Math.floor(remainingMs / 1000),
      syncVersion: session.syncVersion,
      serverTime: now.toISOString(),
    };
  }

  async reconnect(
    assignmentId: string,
    studentId: string,
    clientAnswers?: Record<string, unknown>,
    tabId?: string,
  ) {
    const assignment = await this.prisma.examAssignment.findUnique({
      where: { id: assignmentId },
      include: { section: true },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (assignment.studentId !== studentId) {
      throw new ForbiddenException('Not authorized');
    }

    if (assignment.status === AssignmentStatus.SUBMITTED) {
      return {
        success: false,
        reason: 'already_submitted',
        message: 'This exam has already been submitted',
      };
    }

    let session = await this.sessionService.getSession(assignmentId);

    if (!session) {
      if (
        assignment.status === AssignmentStatus.IN_PROGRESS &&
        assignment.endTime
      ) {
        const now = new Date();
        const gracePeriodEnd = new Date(
          assignment.endTime.getTime() + GRACE_PERIOD_MS,
        );

        if (now > gracePeriodEnd) {
          return {
            success: false,
            reason: 'time_expired',
            message: 'Exam time has expired including grace period',
          };
        }

        session = await this.sessionService.createSession(
          assignmentId,
          studentId,
          assignment.startTime!,
          assignment.endTime,
          assignment.section.duration,
        );

        if (assignment.answers) {
          (session as SessionData).answers = assignment.answers as Record<
            string,
            unknown
          >;
        }
      } else {
        return {
          success: false,
          reason: 'no_session',
          message: 'No active exam session found',
        };
      }
    }

    const sessionData = session as SessionData;

    if (tabId) {
      const lockOk = await this.sessionService.acquireExamLock(
        assignmentId,
        tabId,
      );
      if (!lockOk) {
        return {
          success: false,
          reason: 'another_tab',
          message: 'Exam is open in another tab',
        };
      }
    }

    const mergedAnswers = this.sessionService.mergeAnswers(
      sessionData.answers || {},
      clientAnswers || {},
    );

    const { newVersion } = await this.sessionService.updateAnswers(
      assignmentId,
      mergedAnswers,
      sessionData.highlights || [],
      sessionData.syncVersion,
    );

    await this.prisma.examAssignment.update({
      where: { id: assignmentId },
      data: { answers: mergedAnswers as any },
    });

    const endsAt = new Date(sessionData.endsAt);
    const remainingSeconds = Math.max(
      0,
      Math.floor((endsAt.getTime() - Date.now()) / 1000),
    );

    return {
      success: true,
      reason: 'reconnected',
      assignment: {
        ...assignment,
        answers: mergedAnswers,
        remainingTime: remainingSeconds,
        startTime: assignment.startTime?.toISOString(),
        endTime: assignment.endTime?.toISOString(),
        createdAt: assignment.createdAt.toISOString(),
        updatedAt: assignment.updatedAt.toISOString(),
      },
      syncVersion: newVersion,
    };
  }
}
