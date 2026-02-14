#!/usr/bin/env ts-node

import Redis from 'ioredis';
import 'dotenv/config';

type CliArgs = Record<string, string | boolean>;

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  tls: boolean;
  source: string;
}

interface CheckResult {
  ok: boolean;
  label: string;
  detail: string;
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }

    result[key] = next;
    i += 1;
  }

  return result;
}

function readString(args: CliArgs, key: string, fallback: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : fallback;
}

function readBoolean(args: CliArgs, key: string, fallback: boolean): boolean {
  const value = args[key];
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function readNumber(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseUrlConfig(url: string): Partial<RedisConfig> {
  const parsed = new URL(url);
  const dbFromPath = parsed.pathname.replace('/', '');

  return {
    host: parsed.hostname,
    port: parsed.port
      ? Number(parsed.port)
      : parsed.protocol === 'rediss:'
        ? 6380
        : 6379,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: dbFromPath ? readNumber(dbFromPath, 0) : 0,
    tls: parsed.protocol === 'rediss:',
  };
}

function resolveRedisConfig(prefix: 'SESSION' | 'QUEUE'): RedisConfig {
  const url = process.env[`${prefix}_REDIS_URL`] || process.env.REDIS_URL;

  let base: Partial<RedisConfig> = {};
  let source = `${prefix}_REDIS_HOST/${prefix}_REDIS_PORT`;
  if (url) {
    try {
      base = parseUrlConfig(url);
      source = `${prefix}_REDIS_URL`;
    } catch {
      throw new Error(`Invalid ${prefix}_REDIS_URL/REDIS_URL`);
    }
  }

  const host =
    base.host ||
    process.env[`${prefix}_REDIS_HOST`] ||
    process.env.REDIS_HOST ||
    'localhost';
  const port =
    base.port ||
    readNumber(process.env[`${prefix}_REDIS_PORT`], NaN) ||
    readNumber(process.env.REDIS_PORT, 6379);
  const db =
    base.db ||
    readNumber(process.env[`${prefix}_REDIS_DB`], NaN) ||
    readNumber(process.env.REDIS_DB, 0);
  const password =
    base.password ||
    process.env[`${prefix}_REDIS_PASSWORD`] ||
    process.env.REDIS_PASSWORD;

  const tlsFlag =
    process.env[`${prefix}_REDIS_TLS`] ||
    process.env.REDIS_TLS ||
    (host.includes('upstash.io') ? 'true' : 'false');

  return {
    host,
    port,
    db,
    password,
    tls: base.tls ?? tlsFlag === 'true',
    source,
  };
}

function redisIdentity(config: RedisConfig): string {
  return `${config.host}:${config.port}/db${config.db}/tls:${config.tls ? 'on' : 'off'}`;
}

function timeoutPromise<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

async function checkRedis(label: string, config: RedisConfig): Promise<CheckResult> {
  const client = new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db,
    tls: config.tls ? {} : undefined,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    retryStrategy: () => null,
    reconnectOnError: () => false,
    lazyConnect: true,
  });

  client.on('error', () => undefined);

  try {
    await timeoutPromise(client.connect(), 5000, `${label} connect timeout`);
    const response = await timeoutPromise(client.ping(), 5000, `${label} ping timeout`);

    return {
      ok: response === 'PONG',
      label,
      detail: `${response} (${redisIdentity(config)})`,
    };
  } catch (error) {
    return {
      ok: false,
      label,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.quit().catch(() => undefined);
    client.disconnect();
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function printResult(result: CheckResult) {
  const prefix = result.ok ? '[PASS]' : '[FAIL]';
  console.log(`${prefix} ${result.label}: ${result.detail}`);
}

function usage() {
  console.log('Usage: npm run preflight:p0 -- [options]');
  console.log('');
  console.log('Options:');
  console.log('  --api-base-url <url>           Defaults to http://127.0.0.1:3000/api');
  console.log('  --check-api <true|false>       Defaults to true');
  console.log('  --check-redis <true|false>     Defaults to true');
  console.log('  --allow-shared-redis <bool>    Defaults to false');
  console.log('  --max-fallback-ratio <float>   Defaults to 0.05');
  console.log('  --help                         Show this message');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const results: CheckResult[] = [];

  const requiredEnv = [
    'DATABASE_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'FRONTEND_URL',
    'ADMIN_URL',
  ];

  for (const key of requiredEnv) {
    const exists = typeof process.env[key] === 'string' && process.env[key]!.trim().length > 0;
    results.push({
      ok: exists,
      label: `env:${key}`,
      detail: exists ? 'set' : 'missing',
    });
  }

  const sessionRedis = resolveRedisConfig('SESSION');
  const queueRedis = resolveRedisConfig('QUEUE');

  results.push({
    ok: true,
    label: 'session redis config',
    detail: `${sessionRedis.source} -> ${redisIdentity(sessionRedis)}`,
  });

  results.push({
    ok: true,
    label: 'queue redis config',
    detail: `${queueRedis.source} -> ${redisIdentity(queueRedis)}`,
  });

  const allowSharedRedis = readBoolean(args, 'allow-shared-redis', false);
  const sharedRedis = redisIdentity(sessionRedis) === redisIdentity(queueRedis);

  results.push({
    ok: allowSharedRedis || !sharedRedis,
    label: 'redis workload split',
    detail: sharedRedis
      ? 'session and queue redis are identical'
      : 'session and queue redis are separated',
  });

  const shouldCheckRedis = readBoolean(args, 'check-redis', true);
  if (shouldCheckRedis) {
    results.push(await checkRedis('session redis ping', sessionRedis));
    results.push(await checkRedis('queue redis ping', queueRedis));
  } else {
    results.push({
      ok: true,
      label: 'redis ping checks',
      detail: 'skipped (--check-redis=false)',
    });
  }

  const checkApi = readBoolean(args, 'check-api', true);
  const apiBaseUrl = readString(args, 'api-base-url', 'http://127.0.0.1:3000/api').replace(
    /\/+$/,
    '',
  );

  if (checkApi) {
    try {
      const health = (await fetchJson(`${apiBaseUrl}/health`)) as {
        redis?: boolean;
        database?: boolean;
      };

      results.push({
        ok: Boolean(health.redis),
        label: 'api health redis',
        detail: `redis=${String(health.redis)}`,
      });

      results.push({
        ok: Boolean(health.database),
        label: 'api health database',
        detail: `database=${String(health.database)}`,
      });
    } catch (error) {
      results.push({
        ok: false,
        label: 'api health check',
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const performance = (await fetchJson(`${apiBaseUrl}/health/performance`)) as {
        sessionRuntime?: {
          sync?: {
            total?: number;
            fallbackPath?: number;
          };
        };
      };

      const total = Number(performance.sessionRuntime?.sync?.total || 0);
      const fallback = Number(performance.sessionRuntime?.sync?.fallbackPath || 0);
      const ratio = total > 0 ? fallback / total : 0;

      const maxFallbackRatio = Number(
        readString(args, 'max-fallback-ratio', process.env.P0_MAX_FALLBACK_RATIO || '0.05'),
      );

      const shouldEnforce = total >= 200;
      results.push({
        ok: !shouldEnforce || ratio <= maxFallbackRatio,
        label: 'sync fallback ratio',
        detail: `fallback=${fallback}/${total} (${(ratio * 100).toFixed(2)}%), threshold=${(
          maxFallbackRatio * 100
        ).toFixed(2)}%`,
      });
    } catch (error) {
      results.push({
        ok: false,
        label: 'api performance check',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log('P0 Readiness Report');
  for (const result of results) {
    printResult(result);
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('P0 readiness check failed:', error);
  process.exit(1);
});
