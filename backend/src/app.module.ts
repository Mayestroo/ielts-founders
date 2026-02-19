import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { Response } from 'express';
import { join } from 'path';
import { SmartThrottlerGuard } from './common/guards/smart-throttler.guard';
import { AuthModule } from './modules/auth';
import { CentersModule } from './modules/centers';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ExamsModule } from './modules/exams';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './modules/prisma';
import { QueueModule } from './modules/queue';
import { RedisModule } from './modules/redis';
import { RuntimeFaultModule } from './modules/runtime-fault/runtime-fault.module';
import { SessionModule } from './modules/session';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users';

import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60000, // 1 minute
          limit: 120, // baseline per-minute budget
        },
      ],
    }),
    RuntimeFaultModule,
    RedisModule,
    PrismaModule,
    HealthModule,
    QueueModule,
    SessionModule,
    AuthModule,
    UsersModule,
    ExamsModule,
    CentersModule,
    DashboardModule,
    UploadsModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
      serveStaticOptions: {
        maxAge: 60 * 60 * 1000,
        setHeaders: (res: Response, filePath: string) => {
          if (/\.(mp3|wav|ogg|opus|mp4|webm)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
          }
        },
      },
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SmartThrottlerGuard,
    },
  ],
})
export class AppModule {}
