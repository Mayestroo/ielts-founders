import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Inject,
    NotFoundException,
    Post,
} from '@nestjs/common';
import {
    HealthCheck,
    HealthCheckService,
    MemoryHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import Redis from 'ioredis';
import { ExamSessionService } from '../exam-runtime/exam-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { RuntimeFaultService } from '../runtime-fault/runtime-fault.service';

interface ChaosControlPayload {
  token?: string;
  redisOutageMs?: number;
  dbDelayMs?: number;
  dbDelayDurationMs?: number;
  http502Ms?: number;
}

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private memory: MemoryHealthIndicator,
    @Inject(REDIS_CLIENT) private redis: Redis,
    private prisma: PrismaService,
    private examSessionService: ExamSessionService,
    private runtimeFaultService: RuntimeFaultService,
  ) {}

  @Get()
  @HealthCheck()
  @SkipThrottle()
  check() {
    return this.health.check([
      // Database Check
      async () => {
        const start = Date.now();
        try {
          await this.prisma.$queryRaw`SELECT 1`;
          return {
            database: {
              status: 'up',
              latency: Date.now() - start,
            },
          };
        } catch (e) {
          return {
            database: {
              status: 'down',
              message: e.message,
            },
          };
        }
      },
      // Redis Check
      async () => {
        const start = Date.now();
        try {
          await this.redis.ping();
          return {
            redis: {
              status: 'up',
              latency: Date.now() - start,
            },
          };
        } catch (e) {
          return {
            redis: {
              status: 'down',
              message: e.message,
            },
          };
        }
      },
      // Memory Check (Heap > 300MB is unhealthy)
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
    ]);
  }

  @Get('performance')
  @SkipThrottle()
  getPerformance() {
    const memory = process.memoryUsage();
    const toMb = (value: number) => Number((value / 1024 / 1024).toFixed(2));

    return {
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memoryMB: {
        rss: toMb(memory.rss),
        heapUsed: toMb(memory.heapUsed),
        heapTotal: toMb(memory.heapTotal),
        external: toMb(memory.external),
      },
      faultState: this.runtimeFaultService.getSnapshot(),
      sessionRuntime: this.examSessionService.getPerformanceMetrics(),
    };
  }

  @Get('chaos')
  @SkipThrottle()
  getChaosState() {
    this.ensureChaosEnabled();
    return {
      enabled: true,
      state: this.runtimeFaultService.getSnapshot(),
    };
  }

  @Post('chaos')
  @SkipThrottle()
  setChaosState(@Body() payload: ChaosControlPayload) {
    this.ensureChaosEnabled();

    const expectedToken = process.env.CHAOS_TOKEN || 'local-chaos-token';
    if (!payload?.token || payload.token !== expectedToken) {
      throw new ForbiddenException('Invalid chaos control token');
    }

    const redisOutageMs = Number(payload.redisOutageMs || 0);
    if (Number.isFinite(redisOutageMs) && redisOutageMs > 0) {
      this.runtimeFaultService.activateRedisOutage(redisOutageMs);
    }

    const dbDelayMs = Number(payload.dbDelayMs || 0);
    const dbDelayDurationMs = Number(payload.dbDelayDurationMs || 0);
    if (Number.isFinite(dbDelayMs) && Number.isFinite(dbDelayDurationMs)) {
      this.runtimeFaultService.setDatabaseDelay(dbDelayMs, dbDelayDurationMs);
    }

    const http502Ms = Number(payload.http502Ms || 0);
    if (Number.isFinite(http502Ms) && http502Ms > 0) {
      this.runtimeFaultService.activateHttp502(http502Ms);
    }

    return {
      applied: true,
      state: this.runtimeFaultService.getSnapshot(),
    };
  }

  private ensureChaosEnabled() {
    if (process.env.ENABLE_CHAOS_TESTING !== 'true') {
      throw new NotFoundException('Chaos controls are disabled');
    }
  }
}
