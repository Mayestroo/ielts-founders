import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('RedisModule');

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

        const redis = new Redis({
          host,
          port,
          password,
          db,
          maxRetriesPerRequest: 3, // Fail fast instead of hanging
          lazyConnect: false, // Connect immediately on startup
          tls: useTLS ? {} : undefined, // Enable TLS for Upstash
          retryStrategy: (times) => {
            if (times > 10) return null; // Stop retrying after 10 attempts
            return Math.min(times * 200, 5000); // Exponential backoff, max 5s
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
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
