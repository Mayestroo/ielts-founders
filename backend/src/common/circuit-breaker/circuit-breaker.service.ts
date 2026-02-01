import { Injectable, Logger } from '@nestjs/common';

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  timeoutDuration: number;
  successThreshold: number;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptTime = 0;
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      timeoutDuration: config?.timeoutDuration ?? 60000,
      successThreshold: config?.successThreshold ?? 3,
    };
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  isOpen(): boolean {
    if (this.state === CircuitBreakerState.OPEN) {
      if (Date.now() >= this.nextAttemptTime) {
        this.state = CircuitBreakerState.HALF_OPEN;
        this.logger.log('Circuit breaker transitioning from OPEN to HALF_OPEN');
        return false;
      }
      return true;
    }
    return false;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      const remainingTime = Math.ceil(
        (this.nextAttemptTime - Date.now()) / 1000,
      );
      throw new Error(`Circuit breaker is OPEN. Retry after ${remainingTime}s`);
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = CircuitBreakerState.CLOSED;
        this.successCount = 0;
        this.logger.log(
          'Circuit breaker transitioning from HALF_OPEN to CLOSED',
        );
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.successCount = 0;

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.timeoutDuration;
      this.logger.warn(
        `Circuit breaker transitioning from HALF_OPEN to OPEN. Will retry in ${this.config.timeoutDuration}ms`,
      );
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitBreakerState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.timeoutDuration;
      this.logger.warn(
        `Circuit breaker transitioning from CLOSED to OPEN after ${this.failureCount} failures. Will retry in ${this.config.timeoutDuration}ms`,
      );
    }
  }

  getMetrics(): {
    state: CircuitBreakerState;
    failureCount: number;
    successCount: number;
    nextAttemptIn?: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttemptIn:
        this.state === CircuitBreakerState.OPEN
          ? Math.max(0, this.nextAttemptTime - Date.now())
          : undefined,
    };
  }

  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = 0;
    this.logger.log('Circuit breaker manually reset to CLOSED');
  }
}
