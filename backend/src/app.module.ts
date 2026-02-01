import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { join } from 'path';
import { AuthModule } from './modules/auth';
import { CentersModule } from './modules/centers';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ExamsModule } from './modules/exams';
import { PrismaModule } from './modules/prisma';
import { QueueModule } from './modules/queue';
import { RedisModule } from './modules/redis';
import { SessionModule } from './modules/session';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60000, // 1 minute
          limit: 10, // 10 requests per minute
        },
      ],
    }),
    RedisModule,
    PrismaModule,
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
    }),
  ],
})
export class AppModule {}
