import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { RuntimeFaultService } from './modules/runtime-fault/runtime-fault.service';

import { INestApplication } from '@nestjs/common';

interface RedisConfig {
  host: string;
  port: number;
  db: number;
  tls: boolean;
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseRedisUrl(url: string): Partial<RedisConfig> {
  const parsed = new URL(url);
  const dbFromPath = parsed.pathname.replace('/', '');

  return {
    host: parsed.hostname,
    port: parsed.port
      ? Number(parsed.port)
      : parsed.protocol === 'rediss:'
        ? 6380
        : 6379,
    db: dbFromPath ? readNumber(dbFromPath, 0) : 0,
    tls: parsed.protocol === 'rediss:',
  };
}

function resolveRedisConfig(prefix: 'SESSION' | 'QUEUE'): RedisConfig {
  const redisUrl = process.env[`${prefix}_REDIS_URL`] || process.env.REDIS_URL;

  let baseConfig: Partial<RedisConfig> = {};
  if (redisUrl) {
    try {
      baseConfig = parseRedisUrl(redisUrl);
    } catch {
      throw new Error(`Invalid ${prefix}_REDIS_URL/REDIS_URL`);
    }
  }

  const envPort = readNumber(process.env[`${prefix}_REDIS_PORT`], NaN);
  const fallbackPort = readNumber(process.env.REDIS_PORT, 6379);
  const envDb = readNumber(process.env[`${prefix}_REDIS_DB`], NaN);
  const fallbackDb = readNumber(process.env.REDIS_DB, 0);

  const host =
    baseConfig.host ||
    process.env[`${prefix}_REDIS_HOST`] ||
    process.env.REDIS_HOST ||
    'localhost';

  const port =
    baseConfig.port ?? (Number.isFinite(envPort) ? envPort : fallbackPort);

  const db = baseConfig.db ?? (Number.isFinite(envDb) ? envDb : fallbackDb);

  const tlsFlag = process.env[`${prefix}_REDIS_TLS`] || process.env.REDIS_TLS;

  const tls =
    baseConfig.tls ?? readBoolean(tlsFlag, host.includes('upstash.io'));

  return {
    host,
    port,
    db,
    tls,
  };
}

function redisIdentity(config: RedisConfig): string {
  return `${config.host}:${config.port}/db${config.db}/tls:${config.tls ? 'on' : 'off'}`;
}

function validateProductionReadiness() {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const requiredEnv = [
    'DATABASE_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'FRONTEND_URL',
    'ADMIN_URL',
  ];

  const missing = requiredEnv.filter(
    (key) => !process.env[key] || process.env[key].trim().length === 0,
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required production env vars: ${missing.join(', ')}`,
    );
  }

  const allowSharedRedis = readBoolean(process.env.ALLOW_SHARED_REDIS, false);

  if (!allowSharedRedis) {
    const sessionRedis = resolveRedisConfig('SESSION');
    const queueRedis = resolveRedisConfig('QUEUE');
    const sharedRedis =
      redisIdentity(sessionRedis) === redisIdentity(queueRedis);

    if (sharedRedis) {
      throw new Error(
        'Session and queue Redis are identical. Set SESSION_REDIS_* and QUEUE_REDIS_* separately or ALLOW_SHARED_REDIS=true for temporary non-prod override.',
      );
    }
  }
}

export function setupApp(app: INestApplication) {
  const configService = app.get(ConfigService);
  const runtimeFaultService = app.get(RuntimeFaultService);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.originalUrl || req.url || '';

    if (runtimeFaultService.shouldForceHttp502(path)) {
      res.status(502).json({
        statusCode: 502,
        error: 'Bad Gateway',
        message: 'Simulated upstream failure',
      });
      return;
    }

    const dbDelayMs = runtimeFaultService.getDatabaseDelayMs();
    if (dbDelayMs > 0 && path.startsWith('/api/')) {
      setTimeout(() => next(), dbDelayMs);
      return;
    }

    next();
  });

  // Security: Helmet headers
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // Needed for serving images to frontend
    }),
  );

  // Performance: Compression (exclude binary/audio files — already compressed)
  app.use(
    compression({
      filter: (req, res) => {
        // Never compress audio/video/binary uploads
        if (
          req.url?.startsWith('/uploads/') ||
          req.url?.startsWith('/uploads')
        ) {
          return false;
        }
        const contentType = res.getHeader('Content-Type');
        if (
          typeof contentType === 'string' &&
          (contentType.startsWith('audio/') ||
            contentType.startsWith('video/') ||
            contentType === 'application/octet-stream')
        ) {
          return false;
        }
        // Use default filter for everything else (text, JSON, etc.)
        return compression.filter(req, res);
      },
    }),
  );

  // Enable CORS for frontend apps
  const frontendUrl =
    configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
  const adminUrl =
    configService.get<string>('ADMIN_URL') || 'http://localhost:3002';

  app.enableCors({
    origin: [frontendUrl, adminUrl],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // API prefix
  app.setGlobalPrefix('api');
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  setupApp(app);

  validateProductionReadiness();

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap().catch((err) => {
  console.error('Error during bootstrap:', err);
  process.exit(1);
});
