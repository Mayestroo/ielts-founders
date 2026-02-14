import { Injectable } from '@nestjs/common';

interface FaultState {
  redisOutageUntilMs: number;
  http502UntilMs: number;
  dbDelayMs: number;
  dbDelayUntilMs: number;
}

@Injectable()
export class RuntimeFaultService {
  private state: FaultState = {
    redisOutageUntilMs: 0,
    http502UntilMs: 0,
    dbDelayMs: 0,
    dbDelayUntilMs: 0,
  };

  activateRedisOutage(durationMs: number) {
    const effectiveMs = Math.max(0, Math.floor(durationMs));
    this.state.redisOutageUntilMs = Date.now() + effectiveMs;
  }

  activateHttp502(durationMs: number) {
    const effectiveMs = Math.max(0, Math.floor(durationMs));
    this.state.http502UntilMs = Date.now() + effectiveMs;
  }

  setDatabaseDelay(delayMs: number, durationMs: number) {
    const effectiveDelay = Math.max(0, Math.floor(delayMs));
    const effectiveDuration = Math.max(0, Math.floor(durationMs));

    this.state.dbDelayMs = effectiveDelay;
    this.state.dbDelayUntilMs = Date.now() + effectiveDuration;
  }

  shouldSimulateRedisOutage(): boolean {
    return Date.now() <= this.state.redisOutageUntilMs;
  }

  shouldForceHttp502(path: string): boolean {
    if (Date.now() > this.state.http502UntilMs) {
      return false;
    }

    const normalized = path.toLowerCase();
    if (!normalized.startsWith('/api/')) {
      return false;
    }

    if (normalized.startsWith('/api/health')) {
      return false;
    }

    return true;
  }

  getDatabaseDelayMs(): number {
    if (Date.now() > this.state.dbDelayUntilMs) {
      return 0;
    }

    return this.state.dbDelayMs;
  }

  getSnapshot() {
    const now = Date.now();
    return {
      redisOutageActive: now <= this.state.redisOutageUntilMs,
      redisOutageUntil: this.toIsoOrNull(this.state.redisOutageUntilMs),
      http502Active: now <= this.state.http502UntilMs,
      http502Until: this.toIsoOrNull(this.state.http502UntilMs),
      dbDelayMs: this.getDatabaseDelayMs(),
      dbDelayUntil: this.toIsoOrNull(this.state.dbDelayUntilMs),
    };
  }

  private toIsoOrNull(timestampMs: number): string | null {
    if (timestampMs <= 0) {
      return null;
    }

    return new Date(timestampMs).toISOString();
  }
}
