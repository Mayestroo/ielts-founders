import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { ResponseCacheService } from './response-cache.service';

export { REDIS_CLIENT } from './redis.constants';

const isRedisEnabled = () => {
  if (process.env.DISABLE_REDIS === 'true') {
    return false;
  }

  if (process.env.ENABLE_REDIS === 'true') {
    return true;
  }

  if (process.env.ENABLE_REDIS === 'false') {
    return false;
  }

  const hasExplicitRedisTarget = Boolean(
    process.env.SESSION_REDIS_URL ||
    process.env.REDIS_URL ||
    process.env.SESSION_REDIS_HOST ||
    process.env.REDIS_HOST,
  );

  if (hasExplicitRedisTarget) {
    return true;
  }

  return process.env.NODE_ENV === 'production';
};

const createDisabledRedisClient = () => {
  const buildDisabledError = () => new Error('Redis is disabled');
  const throwDisabled = () => Promise.reject(buildDisabledError());

  const noopClient = {
    on: () => noopClient,
    once: () => noopClient,
    addListener: () => noopClient,
    removeListener: () => noopClient,
    quit: () => Promise.resolve('OK'),
    disconnect: () => undefined,
    ping: throwDisabled,
    get: throwDisabled,
    set: throwDisabled,
    setex: throwDisabled,
    del: throwDisabled,
    scan: throwDisabled,
    eval: throwDisabled,
    ttl: throwDisabled,
    expire: throwDisabled,
    flushall: throwDisabled,
  };

  return noopClient as unknown as Redis;
};

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: async (configService: ConfigService) => {
        const logger = new Logger('RedisModule');

        if (!isRedisEnabled()) {
          logger.warn(
            'Redis is disabled (set ENABLE_REDIS=true to force enable). Using no-op Redis client.',
          );
          return createDisabledRedisClient();
        }

        const redisUrl =
          configService.get<string>('SESSION_REDIS_URL') ||
          configService.get<string>('REDIS_URL');

        let host =
          configService.get<string>('SESSION_REDIS_HOST') ||
          configService.get<string>('REDIS_HOST') ||
          'localhost';
        let port =
          configService.get<number>('SESSION_REDIS_PORT') ||
          configService.get<number>('REDIS_PORT') ||
          6379;
        let password =
          configService.get<string>('SESSION_REDIS_PASSWORD') ||
          configService.get<string>('REDIS_PASSWORD');
        let db =
          configService.get<number>('SESSION_REDIS_DB') ||
          configService.get<number>('REDIS_DB') ||
          0;

        if (redisUrl) {
          try {
            const parsed = new URL(redisUrl);
            host = parsed.hostname || host;
            port = parsed.port
              ? Number(parsed.port)
              : parsed.protocol === 'rediss:'
                ? 6380
                : 6379;

            const pathname = parsed.pathname.replace('/', '');
            if (pathname) {
              const parsedDb = Number(pathname);
              if (Number.isFinite(parsedDb)) {
                db = parsedDb;
              }
            }

            if (parsed.password) {
              password = decodeURIComponent(parsed.password);
            }
          } catch {
            logger.warn(
              'Invalid SESSION_REDIS_URL/REDIS_URL. Falling back to host/port config.',
            );
          }
        }

        const tlsFlag =
          configService.get<string>('SESSION_REDIS_TLS') ||
          configService.get<string>('REDIS_TLS') ||
          'false';

        // Support both standard Redis and Upstash (which requires TLS)
        const useTLS = tlsFlag === 'true' || host.includes('upstash.io');

        const redisRequired =
          configService.get<string>('REDIS_REQUIRED') === 'true' ||
          process.env.NODE_ENV === 'production';

        const redisBaseOptions = {
          host,
          port,
          password,
          db,
          tls: useTLS ? {} : undefined, // Enable TLS for Upstash
        };

        if (!redisRequired) {
          const redis = new Redis({
            ...redisBaseOptions,
            maxRetriesPerRequest: 1,
            lazyConnect: true,
            enableOfflineQueue: false,
            retryStrategy: () => null,
          });

          redis.on('error', (err) => {
            logger.warn(`Redis optional mode error: ${err.message}`);
          });

          try {
            await redis.connect();
            logger.log('Redis connected successfully');
            return redis;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'Unknown redis error';
            logger.warn(
              `Redis unavailable in optional mode (${message}). Using no-op Redis client.`,
            );
            redis.disconnect();
            return createDisabledRedisClient();
          }
        }

        const redis = new Redis({
          ...redisBaseOptions,
          maxRetriesPerRequest: 3,
          lazyConnect: false,
          retryStrategy: (times) => {
            if (times > 10) return null;
            return Math.min(times * 200, 5000);
          },
          reconnectOnError: (err) => {
            const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNRESET'];
            return targetErrors.some((e) => err.message.includes(e));
          },
        });

        redis.on('error', (err) => {
          logger.error('Redis connection error:', err.message);
        });

        redis.on('connect', () => {
          logger.log('Redis connected successfully');
        });

        return redis;
      },
      inject: [ConfigService],
    },
    ResponseCacheService,
  ],
  exports: [REDIS_CLIENT, ResponseCacheService],
})
export class RedisModule {}
