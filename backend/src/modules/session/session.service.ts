import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { RuntimeFaultService } from '../runtime-fault/runtime-fault.service';

export interface ExamSessionData {
  assignmentId: string;
  studentId: string;
  startedAt: string;
  endsAt: string;
  endsAtMs: number;
  answers: Record<string, any>;
  highlights: any[];
  lastSyncAt: string;
  syncVersion: number;
  status: 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'SUBMITTED';
}

export type SessionSyncFailureReason =
  | 'no_session'
  | 'wrong_student'
  | 'inactive'
  | 'invalid_end_time'
  | 'time_expired'
  | 'unknown';

export interface SessionSyncAtomicResult {
  success: boolean;
  newVersion: number;
  conflict?: boolean;
  failureReason?: SessionSyncFailureReason;
  status?: string;
  checkpoint?: {
    answers: Record<string, any>;
    highlights: any[];
  };
}

export interface SessionHeartbeatAtomicResult {
  active: boolean;
  remainingSeconds?: number;
  syncVersion?: number;
  reason?:
    | 'no_session'
    | 'wrong_student'
    | 'submitted'
    | 'expired'
    | 'time_expired'
    | 'another_tab'
    | 'invalid_end_time'
    | 'unknown';
  lockHolder?: string;
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
  private redisDegradedUntilMs = 0;
  private readonly redisBackoffMs = 30000;
  private lastRedisDegradedLogMs = 0;
  private readonly updateAnswersScript = `
local key = KEYS[1]
local expectedVersion = tonumber(ARGV[1])
local incomingAnswers = cjson.decode(ARGV[2])
local incomingHighlightsRaw = ARGV[3]
local nowIso = ARGV[4]

local raw = redis.call('GET', key)
if not raw then
  return {0, -1}
end

local ttl = redis.call('TTL', key)
if ttl <= 0 then
  return {0, -2}
end

local session = cjson.decode(raw)
local currentVersion = tonumber(session.syncVersion or 0)

if currentVersion ~= expectedVersion then
  return {0, currentVersion}
end

if type(session.answers) ~= 'table' then
  session.answers = {}
end

for k, v in pairs(incomingAnswers) do
  session.answers[k] = v
end

if incomingHighlightsRaw and incomingHighlightsRaw ~= '' then
  local incomingHighlights = cjson.decode(incomingHighlightsRaw)
  if type(incomingHighlights) == 'table' and next(incomingHighlights) ~= nil then
    session.highlights = incomingHighlights
  end
end

session.lastSyncAt = nowIso
session.syncVersion = currentVersion + 1

redis.call('SETEX', key, ttl, cjson.encode(session))
return {1, session.syncVersion}
`;
  private readonly upsertExamLockScript = `
local key = KEYS[1]
local tabId = ARGV[1]
local ttl = tonumber(ARGV[2])

local current = redis.call('GET', key)
if not current then
  redis.call('SET', key, tabId, 'EX', ttl)
  return 1
end

if current == tabId then
  redis.call('EXPIRE', key, ttl)
  return 1
end

return 0
`;
  private readonly syncAnswersAtomicScript = `
local sessionKey = KEYS[1]
local expectedVersion = tonumber(ARGV[1])
local studentId = ARGV[2]
local nowMs = tonumber(ARGV[3])
local graceMs = tonumber(ARGV[4])
local checkpointEvery = tonumber(ARGV[5])
local incomingAnswers = cjson.decode(ARGV[6])
local incomingHighlightsRaw = ARGV[7]
local nowIso = ARGV[8]

local raw = redis.call('GET', sessionKey)
if not raw then
  return {-1, 0}
end

local ttl = redis.call('TTL', sessionKey)
if ttl <= 0 then
  return {-1, 0}
end

local session = cjson.decode(raw)

if session.studentId ~= studentId then
  return {-2, 0}
end

if session.status ~= 'ACTIVE' then
  return {-3, 0, tostring(session.status)}
end

local endsAtMs = tonumber(session.endsAtMs or 0)
if endsAtMs <= 0 then
  return {-4, 0}
end

if nowMs > (endsAtMs + graceMs) then
  return {-5, 0}
end

local currentVersion = tonumber(session.syncVersion or 0)
if currentVersion ~= expectedVersion then
  return {2, currentVersion}
end

if type(session.answers) ~= 'table' then
  session.answers = {}
end

for k, v in pairs(incomingAnswers) do
  session.answers[k] = v
end

if incomingHighlightsRaw and incomingHighlightsRaw ~= '' then
  local incomingHighlights = cjson.decode(incomingHighlightsRaw)
  if type(incomingHighlights) == 'table' and next(incomingHighlights) ~= nil then
    session.highlights = incomingHighlights
  end
end

if type(session.highlights) ~= 'table' then
  session.highlights = {}
end

session.lastSyncAt = nowIso
session.syncVersion = currentVersion + 1

redis.call('SETEX', sessionKey, ttl, cjson.encode(session))

if checkpointEvery > 0 and (session.syncVersion % checkpointEvery) == 0 then
  return {
    1,
    session.syncVersion,
    1,
    cjson.encode(session.answers),
    cjson.encode(session.highlights)
  }
end

return {1, session.syncVersion, 0}
`;
  private readonly heartbeatAtomicScript = `
local sessionKey = KEYS[1]
local lockKey = KEYS[2]
local studentId = ARGV[1]
local nowMs = tonumber(ARGV[2])
local graceMs = tonumber(ARGV[3])
local tabId = ARGV[4]
local lockTtl = tonumber(ARGV[5])

local raw = redis.call('GET', sessionKey)
if not raw then
  return {-1}
end

local session = cjson.decode(raw)

if session.studentId ~= studentId then
  return {-2}
end

if session.status ~= 'ACTIVE' then
  return {-3, tostring(session.status)}
end

local endsAtMs = tonumber(session.endsAtMs or 0)
if endsAtMs <= 0 then
  return {-4}
end

local remainingMs = endsAtMs - nowMs
if remainingMs <= -graceMs then
  return {-5}
end

if tabId and tabId ~= '' then
  local current = redis.call('GET', lockKey)
  if not current then
    redis.call('SET', lockKey, tabId, 'EX', lockTtl)
  elseif current == tabId then
    redis.call('EXPIRE', lockKey, lockTtl)
  else
    return {-6, tostring(current)}
  end
end

local remainingSec = math.floor(math.max(0, remainingMs) / 1000)
return {1, remainingSec, tonumber(session.syncVersion or 0)}
`;

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
    @Optional() private readonly runtimeFaultService?: RuntimeFaultService,
    @Optional() ttlConfig?: Partial<RedisTTLConfig>,
  ) {
    this.ttlConfig = {
      sessionGracePeriodMinutes: ttlConfig?.sessionGracePeriodMinutes ?? 5,
      sessionBufferMinutes: ttlConfig?.sessionBufferMinutes ?? 5,
      submittedSessionMinutes: ttlConfig?.submittedSessionMinutes ?? 5,
      submitLockSeconds: ttlConfig?.submitLockSeconds ?? 30,
      examLockSeconds: ttlConfig?.examLockSeconds ?? 60,
    };
  }

  getTTLConfig(): RedisTTLConfig {
    return { ...this.ttlConfig };
  }

  private throwIfRedisFaultActive() {
    if (this.runtimeFaultService?.shouldSimulateRedisOutage()) {
      throw new Error('Simulated Redis outage');
    }

    if (Date.now() < this.redisDegradedUntilMs) {
      throw new Error('Redis temporarily degraded');
    }
  }

  private isRedisTransientError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('max requests limit exceeded') ||
      normalized.includes('readonly') ||
      normalized.includes('etimedout') ||
      normalized.includes('econnreset') ||
      normalized.includes('socket closed') ||
      normalized.includes('connection is closed') ||
      normalized.includes('connect etimedout') ||
      normalized.includes('redis temporarily degraded') ||
      normalized.includes('simulated redis outage')
    );
  }

  private markRedisFailure(error: unknown) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : String(error || 'Unknown redis error');

    if (!this.isRedisTransientError(message)) {
      return;
    }

    const now = Date.now();
    this.redisDegradedUntilMs = Math.max(
      this.redisDegradedUntilMs,
      now + this.redisBackoffMs,
    );

    if (now - this.lastRedisDegradedLogMs >= 5000) {
      this.lastRedisDegradedLogMs = now;
      this.logger.warn(
        `Redis degraded for ${this.redisBackoffMs}ms due to transient error: ${message}`,
      );
    }
  }

  private async withRedis<T>(operation: () => Promise<T>): Promise<T> {
    this.throwIfRedisFaultActive();

    try {
      return await operation();
    } catch (error) {
      this.markRedisFailure(error);
      throw error;
    }
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
      endsAtMs: endsAt.getTime(),
      answers: {},
      highlights: [],
      lastSyncAt: new Date().toISOString(),
      syncVersion: 0,
      status: 'ACTIVE',
    };

    const ttlSeconds = this.calculateSessionTTL(durationMinutes);

    await this.withRedis(() =>
      this.redis.setex(
        this.getSessionKey(assignmentId),
        ttlSeconds,
        JSON.stringify(sessionData),
      ),
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
    const data = await this.withRedis(() =>
      this.redis.get(this.getSessionKey(assignmentId)),
    );
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
    const sessionKey = this.getSessionKey(assignmentId);
    const evalResult = await this.withRedis(() =>
      this.redis.eval(
        this.updateAnswersScript,
        1,
        sessionKey,
        String(expectedVersion),
        JSON.stringify(answers || {}),
        JSON.stringify(highlights || []),
        new Date().toISOString(),
      ),
    );

    const [successCodeRaw, versionRaw] = Array.isArray(evalResult)
      ? evalResult
      : [0, -1];
    const successCode = Number(successCodeRaw);
    const version = Number(versionRaw);

    if (successCode === 1) {
      return { success: true, newVersion: version };
    }

    if (version >= 0) {
      this.logger.warn(
        `Version conflict for ${assignmentId}: expected ${expectedVersion}, got ${version}`,
      );
      return {
        success: false,
        newVersion: version,
        conflict: true,
      };
    }

    return { success: false, newVersion: 0 };
  }

  async syncAnswersAtomic(
    assignmentId: string,
    studentId: string,
    answers: Record<string, any>,
    highlights: any[],
    expectedVersion: number,
    gracePeriodMs: number,
    checkpointEvery: number,
  ): Promise<SessionSyncAtomicResult> {
    const evalResult = await this.withRedis(() =>
      this.redis.eval(
        this.syncAnswersAtomicScript,
        1,
        this.getSessionKey(assignmentId),
        String(expectedVersion),
        studentId,
        String(Date.now()),
        String(gracePeriodMs),
        String(checkpointEvery),
        JSON.stringify(answers || {}),
        JSON.stringify(highlights || []),
        new Date().toISOString(),
      ),
    );

    const resultArray = Array.isArray(evalResult) ? evalResult : [0, 0];
    const code = Number(resultArray[0] ?? 0);

    if (code === 1) {
      const newVersion = Number(resultArray[1] ?? 0);
      const checkpointFlag = Number(resultArray[2] ?? 0);
      if (checkpointFlag !== 1) {
        return {
          success: true,
          newVersion,
        };
      }

      return {
        success: true,
        newVersion,
        checkpoint: {
          answers: this.safeParseJsonObject(resultArray[3]),
          highlights: this.safeParseJsonArray(resultArray[4]),
        },
      };
    }

    if (code === 2) {
      return {
        success: false,
        newVersion: Number(resultArray[1] ?? 0),
        conflict: true,
      };
    }

    const failureReason = this.mapSyncFailureCode(code);
    return {
      success: false,
      newVersion: 0,
      failureReason,
      status: typeof resultArray[2] === 'string' ? resultArray[2] : undefined,
    };
  }

  async heartbeatAtomic(
    assignmentId: string,
    studentId: string,
    tabId: string | undefined,
    gracePeriodMs: number,
  ): Promise<SessionHeartbeatAtomicResult> {
    const evalResult = await this.withRedis(() =>
      this.redis.eval(
        this.heartbeatAtomicScript,
        2,
        this.getSessionKey(assignmentId),
        this.getLockKey(assignmentId),
        studentId,
        String(Date.now()),
        String(gracePeriodMs),
        tabId || '',
        String(this.ttlConfig.examLockSeconds),
      ),
    );

    const resultArray = Array.isArray(evalResult) ? evalResult : [0];
    const code = Number(resultArray[0] ?? 0);

    if (code === 1) {
      return {
        active: true,
        remainingSeconds: Number(resultArray[1] ?? 0),
        syncVersion: Number(resultArray[2] ?? 0),
      };
    }

    if (code === -6) {
      return {
        active: false,
        reason: 'another_tab',
        lockHolder:
          typeof resultArray[1] === 'string' && resultArray[1].length > 0
            ? resultArray[1]
            : undefined,
      };
    }

    if (code === -3) {
      const status =
        typeof resultArray[1] === 'string' && resultArray[1].length > 0
          ? resultArray[1].toUpperCase()
          : 'EXPIRED';

      if (status === 'SUBMITTED') {
        return { active: false, reason: 'submitted' };
      }

      if (status === 'EXPIRED') {
        return { active: false, reason: 'expired' };
      }

      return {
        active: false,
        reason: 'unknown',
      };
    }

    if (code === -1) {
      return { active: false, reason: 'no_session' };
    }

    if (code === -2) {
      return { active: false, reason: 'wrong_student' };
    }

    if (code === -4) {
      return { active: false, reason: 'invalid_end_time' };
    }

    if (code === -5) {
      return { active: false, reason: 'time_expired' };
    }

    return { active: false, reason: 'unknown' };
  }

  private mapSyncFailureCode(code: number): SessionSyncFailureReason {
    if (code === -1) {
      return 'no_session';
    }

    if (code === -2) {
      return 'wrong_student';
    }

    if (code === -3) {
      return 'inactive';
    }

    if (code === -4) {
      return 'invalid_end_time';
    }

    if (code === -5) {
      return 'time_expired';
    }

    return 'unknown';
  }

  private safeParseJsonObject(value: unknown): Record<string, any> {
    if (typeof value !== 'string' || value.length === 0) {
      return {};
    }

    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, any>)
        : {};
    } catch {
      return {};
    }
  }

  private safeParseJsonArray(value: unknown): any[] {
    if (typeof value !== 'string' || value.length === 0) {
      return [];
    }

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Mark session as submitted and remove from Redis
   */
  async markSubmitted(assignmentId: string): Promise<void> {
    const session = await this.getSession(assignmentId);
    if (session) {
      session.status = 'SUBMITTED';
      const ttlSeconds = this.ttlConfig.submittedSessionMinutes * 60;
      await this.withRedis(() =>
        this.redis.setex(
          this.getSessionKey(assignmentId),
          ttlSeconds,
          JSON.stringify(session),
        ),
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
    const result = await this.withRedis(() =>
      this.redis.set(
        this.getSubmitLockKey(assignmentId),
        studentId,
        'EX',
        this.ttlConfig.submitLockSeconds,
        'NX',
      ),
    );
    return result === 'OK';
  }

  /**
   * Release submit lock
   */
  async releaseSubmitLock(assignmentId: string): Promise<void> {
    await this.withRedis(() =>
      this.redis.del(this.getSubmitLockKey(assignmentId)),
    );
  }

  /**
   * Acquire single-tab lock to prevent multi-tab exam taking
   */
  async acquireExamLock(assignmentId: string, tabId: string): Promise<boolean> {
    return this.upsertExamLock(assignmentId, tabId);
  }

  /**
   * Refresh exam lock (heartbeat)
   */
  async refreshExamLock(assignmentId: string, tabId: string): Promise<boolean> {
    return this.upsertExamLock(assignmentId, tabId);
  }

  private async upsertExamLock(
    assignmentId: string,
    tabId: string,
  ): Promise<boolean> {
    const result = await this.withRedis(() =>
      this.redis.eval(
        this.upsertExamLockScript,
        1,
        this.getLockKey(assignmentId),
        tabId,
        String(this.ttlConfig.examLockSeconds),
      ),
    );
    return Number(result) === 1;
  }

  /**
   * Delete session (cleanup)
   */
  async deleteSession(assignmentId: string): Promise<void> {
    await this.withRedis(() =>
      this.redis.del(
        this.getSessionKey(assignmentId),
        this.getLockKey(assignmentId),
        this.getSubmitLockKey(assignmentId),
      ),
    );
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
