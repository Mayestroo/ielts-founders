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

        const host = configService.get<string>('REDIS_HOST') || 'localhost';
        const port = configService.get<number>('REDIS_PORT') || 6379;
        const password = configService.get<string>('REDIS_PASSWORD');
        const db = configService.get<number>('REDIS_DB') || 0;
        const tlsEnabled = configService.get<string>('REDIS_TLS') === 'true';

        // Support both standard Redis and Upstash (which requires TLS)
        const useTLS = tlsEnabled || host.includes('upstash.io');

        const redis = new Redis({
          host,
          port,
          password,
          db,
          maxRetriesPerRequest: null, // Required for BullMQ
          lazyConnect: true,
          tls: useTLS ? {} : undefined, // Enable TLS for Upstash
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
