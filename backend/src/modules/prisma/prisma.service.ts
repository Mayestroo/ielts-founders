import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = `${process.env.DATABASE_URL}`;
    
    // Connection pooling optimized for 20+ concurrent users
    const pool = new Pool({
      connectionString,
      max: 20, // Maximum number of clients in the pool (for 20+ concurrent users)
      min: 5,  // Minimum number of clients to maintain
      idleTimeoutMillis: 300000, // Close idle connections after 5 minutes
      connectionTimeoutMillis: 10000, // Connection timeout
      allowExitOnIdle: false, // Keep connections alive
    });

    // Log pool statistics periodically
    setInterval(() => {
      pool.query('SELECT 1').catch(() => {}); // Keep connections alive
    }, 60000);

    const adapter = new PrismaPg(pool);
    super({ 
      adapter,
      log: process.env.NODE_ENV === 'development' 
        ? ['query', 'info', 'warn', 'error'] 
        : ['error'], // Only log errors in production
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Prisma connected with optimized connection pool');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }
}
