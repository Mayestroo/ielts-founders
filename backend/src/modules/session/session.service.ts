import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

export interface ExamSessionData {
  assignmentId: string;
  studentId: string;
  startedAt: string;
  endsAt: string;
  answers: Record<string, any>;
  highlights: any[];
  lastSyncAt: string;
  syncVersion: number;
  status: 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'SUBMITTED';
}

export interface RedisTTLConfig {
  sessionGracePeriodMinutes: number;
  sessionBufferMinutes: number;
  submittedSessionMinutes: number;
  submitLockSeconds: number;
  examLockSeconds: number;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly SESSION_PREFIX = 'exam:session:';
  private readonly LOCK_PREFIX = 'exam:lock:';
  private readonly SUBMIT_LOCK_PREFIX = 'exam:submit:lock:';
  private readonly ttlConfig: RedisTTLConfig;

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
    @Optional() ttlConfig?: Partial<RedisTTLConfig>,
  ) {
    this.ttlConfig = {
      sessionGracePeriodMinutes: ttlConfig?.sessionGracePeriodMinutes ?? 5,
      sessionBufferMinutes: ttlConfig?.sessionBufferMinutes ?? 5,
      submittedSessionMinutes: ttlConfig?.submittedSessionMinutes ?? 5,
      submitLockSeconds: ttlConfig?.submitLockSeconds ?? 30,
      examLockSeconds: ttlConfig?.examLockSeconds ?? 15,
    };
  }

  getTTLConfig(): RedisTTLConfig {
    return { ...this.ttlConfig };
  }

  // Session key helpers
  private getSessionKey(assignmentId: string): string {
    return `${this.SESSION_PREFIX}${assignmentId}`;
  }

  private getLockKey(assignmentId: string): string {
    return `${this.LOCK_PREFIX}${assignmentId}`;
  }

  private getSubmitLockKey(assignmentId: string): string {
    return `${this.SUBMIT_LOCK_PREFIX}${assignmentId}`;
  }

  /**
   * Create or update an exam session in Redis
   */
  async createSession(
    assignmentId: string,
    studentId: string,
    startedAt: Date,
    endsAt: Date,
    durationMinutes: number,
  ): Promise<ExamSessionData> {
    const sessionData: ExamSessionData = {
      assignmentId,
      studentId,
      startedAt: startedAt.toISOString(),
      endsAt: endsAt.toISOString(),
      answers: {},
      highlights: [],
      lastSyncAt: new Date().toISOString(),
      syncVersion: 0,
      status: 'ACTIVE',
    };

    const ttlSeconds = this.calculateSessionTTL(durationMinutes);

    await this.redis.setex(
      this.getSessionKey(assignmentId),
      ttlSeconds,
      JSON.stringify(sessionData),
    );

    this.logger.log(
      `Created session for assignment ${assignmentId}, TTL: ${ttlSeconds}s`,
    );
    return sessionData;
  }

  private calculateSessionTTL(durationMinutes: number): number {
    const extraMinutes =
      this.ttlConfig.sessionGracePeriodMinutes +
      this.ttlConfig.sessionBufferMinutes;
    return (durationMinutes + extraMinutes) * 60;
  }

  /**
   * Get session data from Redis
   */
  async getSession(assignmentId: string): Promise<ExamSessionData | null> {
    const data = await this.redis.get(this.getSessionKey(assignmentId));
    if (!data) return null;

    try {
      return JSON.parse(data) as ExamSessionData;
    } catch {
      this.logger.error(`Failed to parse session data for ${assignmentId}`);
      return null;
    }
  }

  /**
   * Update session answers with optimistic locking
   */
  async updateAnswers(
    assignmentId: string,
    answers: Record<string, any>,
    highlights: any[],
    expectedVersion: number,
  ): Promise<{ success: boolean; newVersion: number; conflict?: boolean }> {
    const session = await this.getSession(assignmentId);

    if (!session) {
      return { success: false, newVersion: 0 };
    }

    // Optimistic locking check
    if (session.syncVersion !== expectedVersion) {
      this.logger.warn(
        `Version conflict for ${assignmentId}: expected ${expectedVersion}, got ${session.syncVersion}`,
      );
      return {
        success: false,
        newVersion: session.syncVersion,
        conflict: true,
      };
    }

    // Merge answers (client answers override server)
    const mergedAnswers = { ...session.answers, ...answers };
    const newVersion = session.syncVersion + 1;

    const updatedSession: ExamSessionData = {
      ...session,
      answers: mergedAnswers,
      highlights: highlights.length > 0 ? highlights : session.highlights,
      lastSyncAt: new Date().toISOString(),
      syncVersion: newVersion,
    };

    // Get remaining TTL and update
    const ttl = await this.redis.ttl(this.getSessionKey(assignmentId));
    if (ttl > 0) {
      await this.redis.setex(
        this.getSessionKey(assignmentId),
        ttl,
        JSON.stringify(updatedSession),
      );
    }

    return { success: true, newVersion };
  }

  /**
   * Mark session as submitted and remove from Redis
   */
  async markSubmitted(assignmentId: string): Promise<void> {
    const session = await this.getSession(assignmentId);
    if (session) {
      session.status = 'SUBMITTED';
      const ttlSeconds = this.ttlConfig.submittedSessionMinutes * 60;
      await this.redis.setex(
        this.getSessionKey(assignmentId),
        ttlSeconds,
        JSON.stringify(session),
      );
    }
  }

  /**
   * Acquire submit lock (idempotency protection)
   * Returns true if lock acquired, false if already locked
   */
  async acquireSubmitLock(
    assignmentId: string,
    studentId: string,
  ): Promise<boolean> {
    const result = await this.redis.set(
      this.getSubmitLockKey(assignmentId),
      studentId,
      'EX',
      this.ttlConfig.submitLockSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /**
   * Release submit lock
   */
  async releaseSubmitLock(assignmentId: string): Promise<void> {
    await this.redis.del(this.getSubmitLockKey(assignmentId));
  }

  /**
   * Acquire single-tab lock to prevent multi-tab exam taking
   */
  async acquireExamLock(assignmentId: string, tabId: string): Promise<boolean> {
    const existingLock = await this.redis.get(this.getLockKey(assignmentId));

    if (existingLock && existingLock !== tabId) {
      return false; // Another tab has the lock
    }

    await this.redis.setex(
      this.getLockKey(assignmentId),
      this.ttlConfig.examLockSeconds,
      tabId,
    );
    return true;
  }

  /**
   * Refresh exam lock (heartbeat)
   */
  async refreshExamLock(assignmentId: string, tabId: string): Promise<boolean> {
    const existingLock = await this.redis.get(this.getLockKey(assignmentId));

    if (existingLock && existingLock !== tabId) {
      return false; // Lock was taken by another tab
    }

    // If lock is missing (null) or matches current tabId, we can "claim" it or refresh it
    await this.redis.setex(
      this.getLockKey(assignmentId),
      this.ttlConfig.examLockSeconds,
      tabId,
    );
    return true;
  }

  /**
   * Delete session (cleanup)
   */
  async deleteSession(assignmentId: string): Promise<void> {
    await this.redis.del(this.getSessionKey(assignmentId));
    await this.redis.del(this.getLockKey(assignmentId));
    await this.redis.del(this.getSubmitLockKey(assignmentId));
  }

  /**
   * Merge client and server answers (client wins on conflict)
   */
  mergeAnswers(
    serverAnswers: Record<string, any> | undefined,
    clientAnswers: Record<string, any>,
  ): Record<string, any> {
    return { ...(serverAnswers || {}), ...clientAnswers };
  }
}
