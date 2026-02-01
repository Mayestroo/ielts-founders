import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const WRITING_GRADING_QUEUE = 'writing-grading';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('REDIS_HOST') || 'localhost';
        const port = configService.get<number>('REDIS_PORT') || 6379;
        const password = configService.get<string>('REDIS_PASSWORD');
        const db = configService.get<number>('REDIS_DB') || 0;
        const tlsEnabled = configService.get<string>('REDIS_TLS') === 'true';

        // Check if using Upstash (requires TLS)
        const useTLS = tlsEnabled || host.includes('upstash.io');

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
