import { Module } from '@nestjs/common';
import { ExamRuntimeModule } from '../exam-runtime';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { HealthController } from './health.controller';

import { TerminusModule } from '@nestjs/terminus';

@Module({
  imports: [RedisModule, PrismaModule, ExamRuntimeModule, TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
