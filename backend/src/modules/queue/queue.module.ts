import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const WRITING_GRADING_QUEUE = 'writing-grading';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisUrl =
          configService.get<string>('QUEUE_REDIS_URL') ||
          configService.get<string>('REDIS_URL');

        let host =
          configService.get<string>('QUEUE_REDIS_HOST') ||
          configService.get<string>('REDIS_HOST') ||
          'localhost';
        let port =
          configService.get<number>('QUEUE_REDIS_PORT') ||
          configService.get<number>('REDIS_PORT') ||
          6379;
        let password =
          configService.get<string>('QUEUE_REDIS_PASSWORD') ||
          configService.get<string>('REDIS_PASSWORD');
        let db =
          configService.get<number>('QUEUE_REDIS_DB') ||
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
            // Ignore invalid URL and use host/port fallback.
          }
        }

        const tlsFlag =
          configService.get<string>('QUEUE_REDIS_TLS') ||
          configService.get<string>('REDIS_TLS') ||
          'false';

        // Check if using Upstash (requires TLS)
        const useTLS = tlsFlag === 'true' || host.includes('upstash.io');

        return {
          connection: {
            host,
            port,
            password,
            db,
            maxRetriesPerRequest: null,
            tls: useTLS ? {} : undefined,
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: WRITING_GRADING_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5s, 10s, 20s
        },
        removeOnComplete: 100, // Keep last 100 completed
        removeOnFail: 500, // Keep last 500 failed for debugging
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
