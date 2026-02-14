import { Module } from '@nestjs/common';
import { ExamRuntimeModule } from '../exam-runtime';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { HealthController } from './health.controller';

@Module({
  imports: [RedisModule, PrismaModule, ExamRuntimeModule],
  controllers: [HealthController],
})
export class HealthModule {}
