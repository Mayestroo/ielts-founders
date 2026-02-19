import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class ResponseCacheService {
  private readonly logger = new Logger(ResponseCacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const payload = await this.redis.get(key);
      if (!payload) {
        return null;
      }

      return JSON.parse(payload) as T;
    } catch {
      this.logger.warn(`Cache read failed for key "${key}"`);
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await this.redis.set(key, serialized, 'EX', Math.max(1, ttlSeconds));
    } catch {
      this.logger.warn(`Cache write failed for key "${key}"`);
    }
  }

  async getOrSetJson<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.getJson<T>(key);
    if (cached !== null) {
      return cached;
    }

    const fresh = await loader();
    await this.setJson(key, fresh, ttlSeconds);
    return fresh;
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      this.logger.warn(`Cache delete failed for key "${key}"`);
    }
  }

  async delByPrefix(prefix: string): Promise<number> {
    let cursor = '0';
    let removed = 0;

    try {
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          '100',
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          removed += await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch {
      this.logger.warn(`Cache prefix delete failed for prefix "${prefix}"`);
    }

    return removed;
  }

  // [PERF-FIX] Parallelize prefix scans for 3-4× faster cache invalidation — see /performance-audit/
  async delByPrefixes(prefixes: string[]): Promise<number> {
    const results = await Promise.all(
      prefixes.map((prefix) => this.delByPrefix(prefix)),
    );
    return results.reduce((sum, count) => sum + count, 0);
  }
}
