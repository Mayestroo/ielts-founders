import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SessionModule } from '../session.module';
import { SessionService } from '../session.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import Redis from 'ioredis';

const describeRedisIntegration =
  process.env.RUN_REDIS_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describeRedisIntegration('Session Management Integration Tests', () => {
  let app: INestApplication;
  let sessionService: SessionService;
  let redis: Redis;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), SessionModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    sessionService = moduleFixture.get<SessionService>(SessionService);
    redis = moduleFixture.get<Redis>(REDIS_CLIENT);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await redis.flushall();
  });

  afterEach(async () => {
    await redis.flushall();
  });

  describe('Session Creation', () => {
    it('creates a new session with correct TTL', async () => {
      const assignmentId = 'test-assignment-1';
      const studentId = 'student-1';
      const startedAt = new Date();
      const endsAt = new Date(startedAt.getTime() + 30 * 60 * 1000); // 30 minutes
      const duration = 30;

      const session = await sessionService.createSession(
        assignmentId,
        studentId,
        startedAt,
        endsAt,
        duration,
      );

      expect(session.assignmentId).toBe(assignmentId);
      expect(session.studentId).toBe(studentId);
      expect(session.status).toBe('ACTIVE');
      expect(session.syncVersion).toBe(0);
      expect(session.answers).toEqual({});

      // Check TTL is set correctly (duration + 10 minutes = 40 minutes)
      const ttl = await redis.ttl(`exam:session:${assignmentId}`);
      expect(ttl).toBeGreaterThan(duration * 60 - 10);
      expect(ttl).toBeLessThanOrEqual((duration + 10) * 60 + 10);
    });

    it('retrieves existing session', async () => {
      const assignmentId = 'test-assignment-2';
      const created = await sessionService.createSession(
        assignmentId,
        'student-2',
        new Date(),
        new Date(Date.now() + 30 * 60 * 1000),
        30,
      );

      const retrieved = await sessionService.getSession(assignmentId);

      expect(retrieved).toEqual(created);
    });

    it('returns null for non-existent session', async () => {
      const retrieved = await sessionService.getSession('non-existent');

      expect(retrieved).toBeNull();
    });
  });

  describe('Answer Synchronization', () => {
    it('updates answers successfully', async () => {
      const assignmentId = 'test-assignment-3';
      const studentId = 'student-3';

      await sessionService.createSession(
        assignmentId,
        studentId,
        new Date(),
        new Date(Date.now() + 30 * 60 * 1000),
        30,
      );

      const answers = { q1: 'answer1', q2: 'answer2' };
      const highlights = [];
      const version = 0;

      const result = await sessionService.updateAnswers(
        assignmentId,
        answers,
        highlights,
        version,
      );

      expect(result.success).toBe(true);
      expect(result.newVersion).toBe(1);

      const session = await sessionService.getSession(assignmentId);
      expect(session?.answers).toEqual(answers);
      expect(session?.syncVersion).toBe(1);
    });

    it('rejects sync with wrong version (optimistic locking)', async () => {
      const assignmentId = 'test-assignment-4';

      await sessionService.createSession(
        assignmentId,
        'student-4',
        new Date(),
        new Date(Date.now() + 30 * 60 * 1000),
        30,
      );

      // First sync with version 0
      await sessionService.updateAnswers(
        assignmentId,
        { q1: 'answer1' },
        [],
        0,
      );

      // Try to sync with old version (version 0 again)
      const result = await sessionService.updateAnswers(
        assignmentId,
        { q2: 'answer2' },
        [],
        0,
      );

      expect(result.success).toBe(false);
      expect(result.conflict).toBe(true);
      expect(result.newVersion).toBe(1);
    });

    it('preserves TTL on answer update', async () => {
      const assignmentId = 'test-assignment-5';

      const initialTtl = 40 * 60;
      await sessionService.createSession(
        assignmentId,
        'student-5',
        new Date(),
        new Date(Date.now() + 30 * 60 * 1000),
        30,
      );

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      await sessionService.updateAnswers(assignmentId, { q1: 'answer' }, [], 0);

      const ttl = await redis.ttl(`exam:session:${assignmentId}`);
      expect(ttl).toBeLessThan(initialTtl);
      expect(ttl).toBeGreaterThan(initialTtl - 10);
    });
  });

  describe('Exam Lock Management', () => {
    it('acquires lock for new tab', async () => {
      const assignmentId = 'test-assignment-6';
      const tabId = 'tab-1';

      const acquired = await sessionService.acquireExamLock(
        assignmentId,
        tabId,
      );

      expect(acquired).toBe(true);

      const lock = await redis.get(`exam:lock:${assignmentId}`);
      expect(lock).toBe(tabId);
    });

    it('rejects lock for different tab', async () => {
      const assignmentId = 'test-assignment-7';
      const tabId1 = 'tab-2';
      const tabId2 = 'tab-3';

      const firstLock = await sessionService.acquireExamLock(
        assignmentId,
        tabId1,
      );
      expect(firstLock).toBe(true);

      const secondLock = await sessionService.acquireExamLock(
        assignmentId,
        tabId2,
      );
      expect(secondLock).toBe(false);
    });

    it('allows same tab to refresh lock', async () => {
      const assignmentId = 'test-assignment-8';
      const tabId = 'tab-4';

      await sessionService.acquireExamLock(assignmentId, tabId);

      const refreshed = await sessionService.refreshExamLock(
        assignmentId,
        tabId,
      );
      expect(refreshed).toBe(true);

      const lock = await redis.get(`exam:lock:${assignmentId}`);
      expect(lock).toBe(tabId);
    });

    it('rejects lock refresh from different tab', async () => {
      const assignmentId = 'test-assignment-9';
      const tabId1 = 'tab-5';
      const tabId2 = 'tab-6';

      await sessionService.acquireExamLock(assignmentId, tabId1);

      const refreshed = await sessionService.refreshExamLock(
        assignmentId,
        tabId2,
      );
      expect(refreshed).toBe(false);
    });

    it('sets correct TTL on lock acquisition', async () => {
      const assignmentId = 'test-assignment-10';
      const tabId = 'tab-7';

      await sessionService.acquireExamLock(assignmentId, tabId);

      const ttl = await redis.ttl(`exam:lock:${assignmentId}`);
      expect(ttl).toBeGreaterThanOrEqual(40);
      expect(ttl).toBeLessThanOrEqual(50);
    });

    it('extends TTL on lock refresh', async () => {
      const assignmentId = 'test-assignment-11';
      const tabId = 'tab-8';

      await sessionService.acquireExamLock(assignmentId, tabId);

      const initialTtl = await redis.ttl(`exam:lock:${assignmentId}`);

      // Wait 10 seconds
      await new Promise((resolve) => setTimeout(resolve, 10000));

      await sessionService.refreshExamLock(assignmentId, tabId);

      const refreshedTtl = await redis.ttl(`exam:lock:${assignmentId}`);
      expect(refreshedTtl).toBeGreaterThan(initialTtl);
    });
  });

  describe('Submit Lock (Idempotency)', () => {
    it('acquires submit lock', async () => {
      const assignmentId = 'test-assignment-12';
      const studentId = 'student-12';

      const acquired = await sessionService.acquireSubmitLock(
        assignmentId,
        studentId,
      );

      expect(acquired).toBe(true);

      const lock = await redis.get(`exam:submit:lock:${assignmentId}`);
      expect(lock).toBe(studentId);
    });

    it('rejects duplicate submit lock', async () => {
      const assignmentId = 'test-assignment-13';
      const studentId = 'student-13';

      const firstAcquired = await sessionService.acquireSubmitLock(
        assignmentId,
        studentId,
      );
      expect(firstAcquired).toBe(true);

      const secondAcquired = await sessionService.acquireSubmitLock(
        assignmentId,
        studentId,
      );
      expect(secondAcquired).toBe(false);
    });

    it('releases submit lock', async () => {
      const assignmentId = 'test-assignment-14';
      const studentId = 'student-14';

      await sessionService.acquireSubmitLock(assignmentId, studentId);
      await sessionService.releaseSubmitLock(assignmentId);

      const lock = await redis.get(`exam:submit:lock:${assignmentId}`);
      expect(lock).toBeNull();
    });

    it('sets 30 second TTL on submit lock', async () => {
      const assignmentId = 'test-assignment-15';
      const studentId = 'student-15';

      await sessionService.acquireSubmitLock(assignmentId, studentId);

      const ttl = await redis.ttl(`exam:submit:lock:${assignmentId}`);
      expect(ttl).toBeGreaterThanOrEqual(25);
      expect(ttl).toBeLessThanOrEqual(35);
    });
  });

  describe('Session Marking', () => {
    it('marks session as submitted', async () => {
      const assignmentId = 'test-assignment-16';

      await sessionService.createSession(
        assignmentId,
        'student-16',
        new Date(),
        new Date(Date.now() + 30 * 60 * 1000),
        30,
      );

      await sessionService.markSubmitted(assignmentId);

      const session = await sessionService.getSession(assignmentId);
      expect(session?.status).toBe('SUBMITTED');

      const ttl = await redis.ttl(`exam:session:${assignmentId}`);
      expect(ttl).toBeGreaterThanOrEqual(295);
      expect(ttl).toBeLessThanOrEqual(305);
    });
  });

  describe('Cleanup', () => {
    it('deletes all session-related keys', async () => {
      const assignmentId = 'test-assignment-17';

      await sessionService.createSession(
        assignmentId,
        'student-17',
        new Date(),
        new Date(Date.now() + 30 * 60 * 1000),
        30,
      );
      await sessionService.acquireExamLock(assignmentId, 'tab-9');
      await sessionService.acquireSubmitLock(assignmentId, 'student-17');

      await sessionService.deleteSession(assignmentId);

      const session = await redis.get(`exam:session:${assignmentId}`);
      const lock = await redis.get(`exam:lock:${assignmentId}`);
      const submitLock = await redis.get(`exam:submit:lock:${assignmentId}`);

      expect(session).toBeNull();
      expect(lock).toBeNull();
      expect(submitLock).toBeNull();
    });
  });
});
