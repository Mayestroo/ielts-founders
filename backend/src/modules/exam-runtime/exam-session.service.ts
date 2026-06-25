import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus, ExamAssignment, ExamSection } from '@prisma/client';
import { toValidatedJson } from '../../common/utils/json-persistence';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';

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

interface SyncMetrics {
  total: number;
  redisPath: number;
  fallbackPath: number;
  conflicts: number;
  checkpoints: number;
  checkpointFailures: number;
}

type OperationName = 'sync' | 'heartbeat' | 'reconnect';

interface LatencyMetrics {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  samples: number[];
}

interface PendingCheckpoint {
  answers: Record<string, unknown>;
  highlights: unknown[];
}

@Injectable()
export class ExamSessionService {
  private readonly logger = new Logger(ExamSessionService.name);
  private readonly perfMetricsEnabled =
    process.env.EXAM_PERF_METRICS === 'true';
  private readonly syncCheckpointEvery = (() => {
    const parsed = Number.parseInt(
      process.env.EXAM_SYNC_CHECKPOINT_EVERY || '48',
      10,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 48;
  })();
  private readonly metricsEmitEvery = 100;
  private readonly latencySampleSize = 200;
  private readonly syncMetrics: SyncMetrics = {
    total: 0,
    redisPath: 0,
    fallbackPath: 0,
    conflicts: 0,
    checkpoints: 0,
    checkpointFailures: 0,
  };
  private readonly checkpointWrites = new Map<string, Promise<void>>();
  private readonly pendingCheckpoints = new Map<string, PendingCheckpoint>();
  private readonly operationLatency: Record<OperationName, LatencyMetrics> = {
    sync: {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
      samples: [],
    },
    heartbeat: {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
      samples: [],
    },
    reconnect: {
      count: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
      samples: [],
    },
  };

  constructor(
    private prisma: PrismaService,
    private sessionService: SessionService,
  ) {}

  async syncAnswers(
    assignmentId: string,
    studentId: string,
    answers: Record<string, unknown>,
    highlights: unknown[],
    syncVersion: number,
    tabId: string,
  ) {
    const startedAt = Date.now();
    const checkpointEvery = this.syncCheckpointEvery;

    if (!tabId || tabId.trim().length === 0) {
      throw new BadRequestException('tabId is required for sync');
    }

    const normalizedTabId = tabId.trim();

    try {
      this.syncMetrics.total += 1;

      try {
        const lockOk = await this.sessionService.refreshExamLock(
          assignmentId,
          normalizedTabId,
        );

        if (!lockOk) {
          throw new ForbiddenException('Exam is open in another tab');
        }

        const redisResult = await this.sessionService.syncAnswersAtomic(
          assignmentId,
          studentId,
          answers,
          highlights,
          syncVersion,
          GRACE_PERIOD_MS,
          checkpointEvery,
        );

        if (redisResult.success) {
          this.syncMetrics.redisPath += 1;

          if (redisResult.checkpoint) {
            this.syncMetrics.checkpoints += 1;
            this.persistCheckpointAsync(
              assignmentId,
              redisResult.checkpoint.answers,
              redisResult.checkpoint.highlights,
            );
          }

          this.maybeEmitSyncMetrics();
          return {
            success: true,
            newVersion: redisResult.newVersion,
            syncedAt: new Date().toISOString(),
          };
        }

        if (redisResult.conflict) {
          this.syncMetrics.redisPath += 1;
          this.syncMetrics.conflicts += 1;
          this.maybeEmitSyncMetrics();
          return {
            success: false,
            message: 'Version conflict - please refresh session',
            serverVersion: redisResult.newVersion,
            action: 'refresh',
            newVersion: redisResult.newVersion,
            syncedAt: new Date().toISOString(),
          };
        }

        if (redisResult.failureReason === 'wrong_student') {
          throw new ForbiddenException('Not authorized');
        }

        if (redisResult.failureReason === 'inactive') {
          throw new BadRequestException('Exam is not active');
        }

        if (redisResult.failureReason === 'invalid_end_time') {
          throw new BadRequestException('Exam end time is invalid');
        }

        if (redisResult.failureReason === 'time_expired') {
          throw new BadRequestException('Exam time has expired');
        }
      } catch (error) {
        if (
          error instanceof ForbiddenException ||
          error instanceof BadRequestException
        ) {
          throw error;
        }

        this.logger.warn(
          `Redis sync failed for assignment ${assignmentId}, falling back to DB`,
        );
      }

      this.syncMetrics.fallbackPath += 1;
      this.maybeEmitSyncMetrics();

      const assignment = await this.prisma.examAssignment.findUnique({
        where: { id: assignmentId },
        select: {
          studentId: true,
          status: true,
          endTime: true,
          answers: true,
          highlights: true,
        },
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

      if (assignment.status !== AssignmentStatus.IN_PROGRESS) {
        throw new BadRequestException('Exam is not active');
      }

      if (assignment.endTime) {
        const now = Date.now();
        const gracePeriodEnd = assignment.endTime.getTime() + GRACE_PERIOD_MS;
        if (now > gracePeriodEnd) {
          throw new BadRequestException('Exam time has expired');
        }
      }

      return this.persistSyncFallback(
        assignmentId,
        assignment.answers as Record<string, unknown> | null,
        assignment.highlights,
        answers,
        highlights,
        syncVersion,
      );
    } finally {
      this.recordOperationLatency('sync', Date.now() - startedAt);
    }
  }

  private persistCheckpointAsync(
    assignmentId: string,
    answers: Record<string, unknown>,
    highlights: unknown[],
  ) {
    if (this.checkpointWrites.has(assignmentId)) {
      this.pendingCheckpoints.set(assignmentId, { answers, highlights });
      return;
    }

    const writeCheckpoint = async (payload: PendingCheckpoint) => {
      const result = await this.prisma.examAssignment.updateMany({
        where: {
          id: assignmentId,
          status: { not: AssignmentStatus.SUBMITTED },
        },
        data: {
          answers: toValidatedJson(payload.answers, {
            label: 'answers',
            requirePlainObject: true,
          }),
          highlights: toValidatedJson(payload.highlights, {
            label: 'highlights',
            maxBytes: 1024 * 1024,
          }),
        },
      });

      if (result.count === 0) {
        this.syncMetrics.checkpointFailures += 1;
        this.logger.warn(
          `Checkpoint skipped because assignment ${assignmentId} is already submitted`,
        );
      }
    };

    const run = async (payload: PendingCheckpoint): Promise<void> => {
      try {
        await writeCheckpoint(payload);
      } catch {
        this.syncMetrics.checkpointFailures += 1;
        this.logger.warn(
          `Checkpoint persistence failed for assignment ${assignmentId}`,
        );
      } finally {
        const pending = this.pendingCheckpoints.get(assignmentId);
        if (pending) {
          this.pendingCheckpoints.delete(assignmentId);
          const nextRun = run(pending);
          this.checkpointWrites.set(assignmentId, nextRun);
          void nextRun;
        } else {
          this.checkpointWrites.delete(assignmentId);
        }
      }
    };

    const currentRun = run({ answers, highlights });
    this.checkpointWrites.set(assignmentId, currentRun);
    void currentRun;
  }

  private maybeEmitSyncMetrics() {
    if (!this.perfMetricsEnabled) {
      return;
    }

    if (this.syncMetrics.total % this.metricsEmitEvery !== 0) {
      return;
    }

    const syncLatency = this.buildLatencySnapshot('sync');
    this.logger.log(
      `[sync-metrics] total=${this.syncMetrics.total} redisPath=${this.syncMetrics.redisPath} fallbackPath=${this.syncMetrics.fallbackPath} conflicts=${this.syncMetrics.conflicts} checkpoints=${this.syncMetrics.checkpoints} checkpointFailures=${this.syncMetrics.checkpointFailures} avgMs=${syncLatency.avgMs} p95Ms=${syncLatency.p95Ms} maxMs=${syncLatency.maxMs}`,
    );
  }

  getPerformanceMetrics() {
    return {
      sync: { ...this.syncMetrics },
      operations: {
        sync: this.buildLatencySnapshot('sync'),
        heartbeat: this.buildLatencySnapshot('heartbeat'),
        reconnect: this.buildLatencySnapshot('reconnect'),
      },
    };
  }

  private recordOperationLatency(operation: OperationName, elapsedMs: number) {
    const latency = this.operationLatency[operation];
    const normalized = Math.max(0, elapsedMs);

    latency.count += 1;
    latency.totalMs += normalized;
    latency.lastMs = normalized;
    latency.maxMs = Math.max(latency.maxMs, normalized);
    latency.samples.push(normalized);
    if (latency.samples.length > this.latencySampleSize) {
      latency.samples.shift();
    }
  }

  private buildLatencySnapshot(operation: OperationName) {
    const latency = this.operationLatency[operation];
    const avgMs =
      latency.count > 0
        ? Number((latency.totalMs / latency.count).toFixed(2))
        : 0;
    const p95Ms = this.calculatePercentile(latency.samples, 95);

    return {
      count: latency.count,
      avgMs,
      p95Ms,
      maxMs: Number(latency.maxMs.toFixed(2)),
      lastMs: Number(latency.lastMs.toFixed(2)),
      sampleSize: latency.samples.length,
    };
  }

  private calculatePercentile(samples: number[], percentile: number): number {
    if (samples.length === 0) {
      return 0;
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1),
    );
    return Number(sorted[index].toFixed(2));
  }

  async heartbeat(
    assignmentId: string,
    studentId: string,
    tabId?: string,
  ): Promise<{
    active: boolean;
    reason?: string;
    remainingSeconds?: number;
    syncVersion?: number;
    serverTime?: string;
    degraded?: boolean;
  }> {
    const startedAt = Date.now();

    try {
      try {
        const heartbeat = await this.sessionService.heartbeatAtomic(
          assignmentId,
          studentId,
          tabId,
          GRACE_PERIOD_MS,
        );

        if (heartbeat.active) {
          return {
            active: true,
            remainingSeconds: heartbeat.remainingSeconds ?? 0,
            syncVersion: heartbeat.syncVersion ?? 0,
            serverTime: new Date().toISOString(),
          };
        }

        if (heartbeat.reason === 'wrong_student') {
          return { active: false, reason: 'wrong_student' };
        }

        if (heartbeat.reason === 'submitted') {
          return { active: false, reason: 'submitted' };
        }

        if (heartbeat.reason === 'expired') {
          return { active: false, reason: 'expired' };
        }

        if (heartbeat.reason === 'time_expired') {
          return { active: false, reason: 'time_expired' };
        }

        if (heartbeat.reason === 'another_tab') {
          this.logger.warn(
            `[Heartbeat] Lock conflict for assignment ${assignmentId}. Current tab: ${tabId || 'n/a'}, Holding tab: ${heartbeat.lockHolder || 'unknown'}`,
          );
          return { active: false, reason: 'another_tab' };
        }
      } catch {
        this.logger.warn(
          `Redis unavailable during heartbeat for assignment ${assignmentId}, using DB fallback`,
        );
        return this.heartbeatFromDatabase(assignmentId, studentId);
      }

      // [PERF-FIX] Only fetch section.duration for session recovery, avoids loading large JSON — see /performance-audit/
      const assignment = await this.prisma.examAssignment.findUnique({
        where: { id: assignmentId },
        include: {
          section: {
            select: { duration: true },
          },
        },
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
      try {
        await this.sessionService.createSession(
          assignmentId,
          studentId,
          assignment.startTime!,
          assignment.endTime,
          assignment.section.duration,
        );
      } catch {
        this.logger.warn(
          `Redis unavailable while recreating session for assignment ${assignmentId}, using DB fallback`,
        );
        return this.heartbeatFromDatabase(assignmentId, studentId);
      }

      return this.heartbeatFromDatabase(assignmentId, studentId);
    } finally {
      this.recordOperationLatency('heartbeat', Date.now() - startedAt);
    }
  }

  async reconnect(
    assignmentId: string,
    studentId: string,
    clientAnswers?: Record<string, unknown>,
    tabId?: string,
  ) {
    const startedAt = Date.now();

    try {
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

      if (
        assignment.status !== AssignmentStatus.IN_PROGRESS ||
        !assignment.endTime
      ) {
        return {
          success: false,
          reason: 'no_session',
          message: 'No active exam session found',
        };
      }

      const now = Date.now();
      const gracePeriodEnd = assignment.endTime.getTime() + GRACE_PERIOD_MS;
      if (now > gracePeriodEnd) {
        return {
          success: false,
          reason: 'time_expired',
          message: 'Exam time has expired including grace period',
        };
      }

      try {
        let session = await this.sessionService.getSession(assignmentId);

        if (!session) {
          const createdSession = await this.sessionService.createSession(
            assignmentId,
            studentId,
            assignment.startTime || new Date(),
            assignment.endTime,
            assignment.section.duration,
          );

          session = createdSession;

          if (assignment.answers) {
            const assignmentAnswers = assignment.answers as Record<
              string,
              unknown
            >;
            const assignmentHighlights = Array.isArray(assignment.highlights)
              ? assignment.highlights
              : [];
            const seedResult = await this.sessionService.updateAnswers(
              assignmentId,
              assignmentAnswers,
              assignmentHighlights,
              0,
            );

            if (seedResult.success) {
              session = {
                ...createdSession,
                answers: assignmentAnswers,
                highlights: assignmentHighlights,
                syncVersion: seedResult.newVersion,
              };
            } else {
              session = await this.sessionService.getSession(assignmentId);
            }
          }
        }

        if (!session) {
          return this.reconnectFromDatabase(assignment, clientAnswers);
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

        const updateResult = await this.sessionService.updateAnswers(
          assignmentId,
          mergedAnswers,
          sessionData.highlights || [],
          sessionData.syncVersion,
        );

        if (updateResult.conflict) {
          const refreshedSession =
            await this.sessionService.getSession(assignmentId);
          if (!refreshedSession) {
            return this.reconnectFromDatabase(assignment, clientAnswers);
          }

          const refreshedAnswers = this.sessionService.mergeAnswers(
            (refreshedSession as SessionData).answers || {},
            clientAnswers || {},
          );

          const retryUpdate = await this.sessionService.updateAnswers(
            assignmentId,
            refreshedAnswers,
            (refreshedSession as SessionData).highlights || [],
            (refreshedSession as SessionData).syncVersion,
          );

          if (!retryUpdate.success) {
            return this.reconnectFromDatabase(assignment, clientAnswers);
          }

          this.persistReconnectCheckpointAsync(assignmentId, refreshedAnswers);

          const endsAt = assignment.endTime;
          const remainingSeconds = Math.max(
            0,
            Math.floor((endsAt.getTime() - Date.now()) / 1000),
          );

          return {
            success: true,
            reason: 'reconnected',
            assignment: {
              ...assignment,
              section: this.sanitizeSectionForStudent(assignment.section),
              answers: refreshedAnswers,
              remainingTime: remainingSeconds,
              startTime: assignment.startTime?.toISOString(),
              endTime: assignment.endTime?.toISOString(),
              createdAt: assignment.createdAt.toISOString(),
              updatedAt: assignment.updatedAt.toISOString(),
            },
            syncVersion: retryUpdate.newVersion,
          };
        }

        if (!updateResult.success) {
          return this.reconnectFromDatabase(assignment, clientAnswers);
        }

        if (
          updateResult.newVersion > 0 &&
          updateResult.newVersion % this.syncCheckpointEvery === 0
        ) {
          this.persistReconnectCheckpointAsync(assignmentId, mergedAnswers);
        }

        const endsAt = assignment.endTime;
        const remainingSeconds = Math.max(
          0,
          Math.floor((endsAt.getTime() - Date.now()) / 1000),
        );

        return {
          success: true,
          reason: 'reconnected',
          assignment: {
            ...assignment,
            section: this.sanitizeSectionForStudent(assignment.section),
            answers: mergedAnswers,
            remainingTime: remainingSeconds,
            startTime: assignment.startTime?.toISOString(),
            endTime: assignment.endTime?.toISOString(),
            createdAt: assignment.createdAt.toISOString(),
            updatedAt: assignment.updatedAt.toISOString(),
          },
          syncVersion: updateResult.newVersion,
        };
      } catch {
        this.logger.warn(
          `Redis unavailable during reconnect for assignment ${assignmentId}, using DB fallback`,
        );
        return this.reconnectFromDatabase(assignment, clientAnswers);
      }
    } finally {
      this.recordOperationLatency('reconnect', Date.now() - startedAt);
    }
  }

  private async persistSyncFallback(
    assignmentId: string,
    serverAnswers: Record<string, unknown> | null,
    serverHighlights: unknown,
    incomingAnswers: Record<string, unknown>,
    incomingHighlights: unknown[],
    syncVersion: number,
  ) {
    const mergedAnswers = {
      ...(serverAnswers || {}),
      ...incomingAnswers,
    };
    const mergedHighlights =
      incomingHighlights.length > 0
        ? incomingHighlights
        : (serverHighlights ?? []);

    const updated = await this.prisma.examAssignment.updateMany({
      where: {
        id: assignmentId,
        status: AssignmentStatus.IN_PROGRESS,
      },
      data: {
        answers: toValidatedJson(mergedAnswers, {
          label: 'answers',
          requirePlainObject: true,
        }),
        highlights: toValidatedJson(mergedHighlights, {
          label: 'highlights',
          maxBytes: 1024 * 1024,
        }),
      },
    });

    if (updated.count !== 1) {
      throw new BadRequestException('Exam is not active');
    }

    return {
      success: true,
      newVersion: syncVersion + 1,
      syncedAt: new Date().toISOString(),
      degraded: true,
    };
  }

  private persistReconnectCheckpointAsync(
    assignmentId: string,
    answers: Record<string, unknown>,
  ) {
    void this.prisma.examAssignment
      .updateMany({
        where: {
          id: assignmentId,
          status: AssignmentStatus.IN_PROGRESS,
        },
        data: {
          answers: toValidatedJson(answers, {
            label: 'answers',
            requirePlainObject: true,
          }),
        },
      })
      .then((result) => {
        if (result.count === 0) {
          this.logger.warn(
            `Reconnect checkpoint skipped because assignment ${assignmentId} is not active`,
          );
        }
      })
      .catch(() => {
        this.logger.warn(
          `Reconnect checkpoint persistence failed for assignment ${assignmentId}`,
        );
      });
  }

  private async heartbeatFromDatabase(assignmentId: string, studentId: string) {
    const assignment = await this.prisma.examAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        studentId: true,
        status: true,
        endTime: true,
      },
    });

    if (!assignment) {
      return { active: false, reason: 'no_session' };
    }

    if (assignment.studentId !== studentId) {
      return { active: false, reason: 'wrong_student' };
    }

    if (assignment.status === AssignmentStatus.SUBMITTED) {
      return { active: false, reason: 'submitted' };
    }

    if (
      assignment.status !== AssignmentStatus.IN_PROGRESS ||
      !assignment.endTime
    ) {
      return { active: false, reason: 'no_session' };
    }

    const remainingMs = assignment.endTime.getTime() - Date.now();
    if (remainingMs <= -GRACE_PERIOD_MS) {
      return { active: false, reason: 'time_expired' };
    }

    return {
      active: true,
      remainingSeconds: Math.max(0, Math.floor(remainingMs / 1000)),
      serverTime: new Date().toISOString(),
      degraded: true,
    };
  }

  private async reconnectFromDatabase(
    assignment: ExamAssignment & { section: ExamSection },
    clientAnswers?: Record<string, unknown>,
  ) {
    if (
      assignment.status !== AssignmentStatus.IN_PROGRESS ||
      !assignment.endTime
    ) {
      return {
        success: false,
        reason: 'no_session',
        message: 'No active exam session found',
      };
    }

    if (Date.now() > assignment.endTime.getTime() + GRACE_PERIOD_MS) {
      return {
        success: false,
        reason: 'time_expired',
        message: 'Exam time has expired including grace period',
      };
    }

    const mergedAnswers = this.sessionService.mergeAnswers(
      (assignment.answers || {}) as Record<string, unknown>,
      clientAnswers || {},
    );

    if (clientAnswers && Object.keys(clientAnswers).length > 0) {
      const updated = await this.prisma.examAssignment.updateMany({
        where: {
          id: assignment.id,
          status: AssignmentStatus.IN_PROGRESS,
        },
        data: {
          answers: toValidatedJson(mergedAnswers, {
            label: 'answers',
            requirePlainObject: true,
          }),
        },
      });

      if (updated.count !== 1) {
        return {
          success: false,
          reason: 'no_session',
          message: 'No active exam session found',
          degraded: true,
        };
      }
    }

    const remainingSeconds = Math.max(
      0,
      Math.floor((assignment.endTime.getTime() - Date.now()) / 1000),
    );

    return {
      success: true,
      reason: 'reconnected',
      assignment: {
        ...assignment,
        section: this.sanitizeSectionForStudent(assignment.section),
        answers: mergedAnswers,
        remainingTime: remainingSeconds,
        startTime: assignment.startTime?.toISOString(),
        endTime: assignment.endTime?.toISOString(),
        createdAt: assignment.createdAt.toISOString(),
        updatedAt: assignment.updatedAt.toISOString(),
      },
      syncVersion: 0,
      degraded: true,
    };
  }

  private sanitizeSectionForStudent(section: ExamSection | null) {
    if (
      !section ||
      !section.questions ||
      !Array.isArray(section.questions as unknown[])
    ) {
      return section;
    }

    const questions = (section.questions as unknown[]).map(
      (question: unknown) => {
        if (!question || typeof question !== 'object') {
          return question;
        }

        const q = question as Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { correctAnswer, correctAnswers, ...safeQuestion } = q;
        return safeQuestion;
      },
    );

    return {
      ...section,
      questions,
    };
  }
}
