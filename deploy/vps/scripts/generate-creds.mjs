#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// /srv/ielts/deploy/vps/scripts -> /srv/ielts
const repoRoot = path.resolve(__dirname, '../../..');

const nowIso = new Date().toISOString();

const randHex = (bytes) => crypto.randomBytes(bytes).toString('hex');

const postgresDb = 'ielts_prod';
const postgresUser = 'ielts_app';
const postgresPassword = randHex(24);

const sessionRedisPassword = randHex(24);
const queueRedisPassword = randHex(24);

const jwtSecret = randHex(64);
const jwtRefreshSecret = randHex(64);

const chaosToken = randHex(24);

const contents = `# Generated ${nowIso}
# IMPORTANT: keep this file private. Do NOT commit.

## Domains
FRONTEND_URL=https://founderscdi.uz
ADMIN_URL=https://admin.founderscdi.uz
BACKEND_URL=https://api.founderscdi.uz
NEXT_PUBLIC_API_URL=https://api.founderscdi.uz/api

## Google (fill these)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_ID=

## Postgres (Docker)
POSTGRES_DB=${postgresDb}
POSTGRES_USER=${postgresUser}
POSTGRES_PASSWORD=${postgresPassword}
DATABASE_URL=postgresql://${postgresUser}:${postgresPassword}@postgres:5432/${postgresDb}?schema=public&connection_limit=20&pool_timeout=20

## JWT
JWT_SECRET=${jwtSecret}
JWT_REFRESH_SECRET=${jwtRefreshSecret}
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

## Redis
SESSION_REDIS_PASSWORD=${sessionRedisPassword}
QUEUE_REDIS_PASSWORD=${queueRedisPassword}
SESSION_REDIS_URL=redis://:${sessionRedisPassword}@redis-session:6379/0
QUEUE_REDIS_URL=redis://:${queueRedisPassword}@redis-queue:6379/0
SESSION_REDIS_TLS=false
QUEUE_REDIS_TLS=false

## Center defaults (fill these after DB restore)
DEFAULT_STUDENT_CENTER_ID=
GOOGLE_DEFAULT_CENTER_ID=

## AI (fill this)
GEMINI_API_KEY=

## Runtime tuning
ALLOW_SHARED_REDIS=false
EXAM_SYNC_CHECKPOINT_EVERY=48
EXAM_PERF_METRICS=true
HTTP_CLIENT_TIMEOUT_MS=15000
AI_EVALUATION_TIMEOUT_MS=45000
AI_MAX_TOTAL_ATTEMPTS=12
P0_MAX_FALLBACK_RATIO=0.05

## Feature flags
ENABLE_CHAOS_TESTING=false
CHAOS_TOKEN=${chaosToken}
UPLOAD_SCAN_COMMAND=
`;

const outputPath = path.join(repoRoot, 'creds.txt');

if (fs.existsSync(outputPath)) {
  const backupPath = path.join(repoRoot, `creds.backup.${Date.now()}.txt`);
  fs.renameSync(outputPath, backupPath);
}

fs.writeFileSync(outputPath, contents, { encoding: 'utf8', mode: 0o600 });
fs.chmodSync(outputPath, 0o600);

console.log(`Wrote ${outputPath}`);
