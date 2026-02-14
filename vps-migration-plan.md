# IELTS Platform VPS Migration Plan (Production)

Prepared for stack:

- Backend: NestJS API
- Student frontend: Next.js
- Admin panel: Next.js
- DB: PostgreSQL (Prisma)
- Redis: migrate from Upstash to VPS-hosted Redis
- Runtime-critical paths: exam heartbeat/sync/submit/locks

Assumptions:

- Ubuntu 22.04+
- Domains:
  - Student web: `founderscdi.uz`
  - API: `api.founderscdi.uz`
  - Admin: `admin.founderscdi.uz`

Use these shell variables:

```bash
export DOMAIN="founderscdi.uz"
export API_DOMAIN="api.${DOMAIN}"
export ADMIN_DOMAIN="admin.${DOMAIN}"
export EMAIL="ops@${DOMAIN}"
export VPS_IP="x.x.x.x"
```

Implementation assets in this repository:

- Docker stack: `deploy/vps/docker-compose.yml`
- Docker Nginx: `deploy/vps/nginx/conf.d/ielts.conf`
- PM2 ecosystem: `deploy/vps/pm2/ecosystem.config.js`
- PM2 Nginx: `deploy/vps/nginx/ielts.pm2.conf`
- Env templates: `deploy/vps/env/*.example`, `backend/.env.production.example`, `frontend/.env.production.example`, `admin-panel/.env.production.example`
- Redis configs: `deploy/vps/redis/session.conf`, `deploy/vps/redis/queue.conf`
- Ops scripts: `deploy/vps/scripts/*.sh`
- Runbook/checklists: `deploy/vps/runbook.md`, `deploy/vps/checklists.md`, `deploy/vps/README.md`

---

## Part 1 - Target VPS Architecture

Recommended baseline for 50-100 concurrent students:

- 8 vCPU, 16 GB RAM, NVMe SSD
- Nginx at edge (80/443)
- API/web/admin on internal ports
- PostgreSQL and Redis private only
- Separate queue worker process from API

Architecture diagram:

```text
                          Internet
                              |
                         80/443 (TLS)
                              |
                           Nginx
         ------------------------------------------------
         |                      |                       |
  api.founderscdi.uz      founderscdi.uz      admin.founderscdi.uz
         |                      |                       |
      NestJS API            Next.js web            Next.js admin
      :3000 (internal)      :3001 (internal)       :3002 (internal)
         |
  --------------------------
  |                        |
PostgreSQL             Redis Session + Redis Queue
:5432 private          :6379 (session) + :6380 (queue)
  |
Optional Worker (BullMQ processor, writing grading)
```

Routing and port mapping:

- `api.<domain>` -> API upstream (`127.0.0.1:3000` or container `api:3000`)
- `<domain>` -> student frontend (`127.0.0.1:3001` or container `web:3000`)
- `admin.<domain>` -> admin frontend (`127.0.0.1:3002` or container `admin:3000`)
- DB and Redis are not publicly reachable.

---

## Part 2 - Redis Migration (Upstash -> VPS Redis)

### 2.1 Install Redis on Ubuntu and secure it

Install:

```bash
sudo apt update
sudo apt install -y redis-server
sudo systemctl stop redis-server
sudo systemctl disable redis-server
```

Generate strong passwords:

```bash
openssl rand -base64 48
openssl rand -base64 48
# save as SESSION_REDIS_PASSWORD and QUEUE_REDIS_PASSWORD
```

Create two Redis instance configs:

```bash
sudo cp /etc/redis/redis.conf /etc/redis/redis-session.conf
sudo cp /etc/redis/redis.conf /etc/redis/redis-queue.conf
```

`/etc/redis/redis-session.conf`:

```conf
bind 127.0.0.1 ::1
protected-mode yes
port 6379
supervised systemd
daemonize no

requirepass <SESSION_REDIS_PASSWORD>
rename-command FLUSHALL ""
rename-command FLUSHDB ""

dir /var/lib/redis
dbfilename dump-session.rdb

appendonly yes
appendfilename "appendonly-session.aof"
appendfsync everysec
no-appendfsync-on-rewrite yes

save 900 1
save 300 10
save 60 10000

maxmemory 2gb
maxmemory-policy noeviction
tcp-keepalive 60
timeout 0
```

`/etc/redis/redis-queue.conf`:

```conf
bind 127.0.0.1 ::1
protected-mode yes
port 6380
supervised systemd
daemonize no

requirepass <QUEUE_REDIS_PASSWORD>
rename-command FLUSHALL ""
rename-command FLUSHDB ""

dir /var/lib/redis
dbfilename dump-queue.rdb

appendonly yes
appendfilename "appendonly-queue.aof"
appendfsync everysec
no-appendfsync-on-rewrite yes

save 900 1
save 300 10
save 60 10000

maxmemory 1gb
maxmemory-policy noeviction
tcp-keepalive 60
timeout 0
```

Enable/start both instances:

```bash
sudo systemctl enable --now redis-server@redis-session
sudo systemctl enable --now redis-server@redis-queue
sudo systemctl status redis-server@redis-session --no-pager
sudo systemctl status redis-server@redis-queue --no-pager
```

Verify:

```bash
redis-cli -h 127.0.0.1 -p 6379 -a '<SESSION_REDIS_PASSWORD>' ping
redis-cli -h 127.0.0.1 -p 6380 -a '<QUEUE_REDIS_PASSWORD>' ping
```

### 2.2 Redis settings rationale for exam runtime

- `appendonly yes` with `appendfsync everysec`: durable enough with low latency overhead.
- `maxmemory-policy noeviction`: critical to avoid random lock/session key eviction.
- `tcp-keepalive 60`: better connection stability.
- Separate session and queue Redis avoids noisy-neighbor impact.

### 2.3 Application config changes

Use split env vars (already supported by project modules):

```env
SESSION_REDIS_URL=redis://:<SESSION_REDIS_PASSWORD>@127.0.0.1:6379/0
QUEUE_REDIS_URL=redis://:<QUEUE_REDIS_PASSWORD>@127.0.0.1:6380/0

# Optional fallback only
REDIS_URL=
REDIS_TLS=false
```

Recommended ioredis settings:

```ts
{
  lazyConnect: false,
  connectTimeout: 5000,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 5000),
  reconnectOnError: (err) => /READONLY|ETIMEDOUT|ECONNRESET|EAI_AGAIN/.test(err.message),
  enableReadyCheck: true,
  keepAlive: 60000,
}
```

For BullMQ queue connection, `maxRetriesPerRequest: null` remains acceptable.

### 2.4 Safe Redis migration strategy

Important: there is no practical way to losslessly transfer in-flight lock/session semantics from Upstash while exams are active. Use controlled cutover.

Cutover plan:

1. Move queue Redis first (lower student impact).
2. Move session Redis only when no active exams.

Check active exams:

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS in_progress FROM \"ExamAssignment\" WHERE status='IN_PROGRESS';"
```

Session Redis cutover sequence:

1. Maintenance window.
2. Verify `in_progress = 0`.
3. Update env to local `SESSION_REDIS_URL`.
4. Restart API/worker.
5. Verify runtime health endpoints.

Redis latency validation:

```bash
redis-cli -h 127.0.0.1 -p 6379 -a '<SESSION_REDIS_PASSWORD>' --latency -i 1
redis-cli -h 127.0.0.1 -p 6380 -a '<QUEUE_REDIS_PASSWORD>' --latency -i 1
curl -fsS "https://${API_DOMAIN}/api/health"
curl -fsS "https://${API_DOMAIN}/api/health/performance"
```

---

## Part 3 - PostgreSQL on VPS

### 3.1 Install and secure PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

Create DB and app user:

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE ielts_app WITH LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE ielts_prod OWNER ielts_app;
GRANT ALL PRIVILEGES ON DATABASE ielts_prod TO ielts_app;
SQL
```

Bind local only and require password auth:

```bash
PG_VER=$(ls /etc/postgresql | sort -V | tail -n1)
sudo sed -i "s/^#listen_addresses.*/listen_addresses = '127.0.0.1'/" /etc/postgresql/${PG_VER}/main/postgresql.conf
```

`/etc/postgresql/<ver>/main/pg_hba.conf`:

```conf
local   all             postgres                                peer
local   all             all                                     scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
```

```bash
sudo systemctl restart postgresql
```

### 3.2 Prisma deployment

Use in production:

```bash
npx prisma migrate deploy
npx prisma generate
```

Do not use `migrate dev` in production.

Recommended DB URL format:

```env
DATABASE_URL=postgresql://ielts_app:CHANGE_ME@127.0.0.1:5432/ielts_prod?schema=public&connection_limit=20&pool_timeout=20
```

### 3.3 Backup + retention + restore test

`/usr/local/bin/pg_backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/srv/backups/postgres"
DATE="$(date +%F_%H-%M-%S)"
mkdir -p "$BACKUP_DIR"

export PGPASSWORD="<DB_PASSWORD>"
pg_dump -h 127.0.0.1 -U ielts_app -d ielts_prod -Fc > "${BACKUP_DIR}/ielts_prod_${DATE}.dump"

find "$BACKUP_DIR" -type f -name "*.dump" -mtime +14 -delete
```

```bash
sudo chmod +x /usr/local/bin/pg_backup.sh
sudo crontab -e
# Daily at 02:10
10 2 * * * /usr/local/bin/pg_backup.sh >/var/log/pg_backup.log 2>&1
```

Restore test:

```bash
createdb -h 127.0.0.1 -U ielts_app ielts_restore_test
pg_restore -h 127.0.0.1 -U ielts_app -d ielts_restore_test /srv/backups/postgres/ielts_prod_<DATE>.dump
```

---

## Part 4 - Project Prep: Env, Build, Release

### 4.1 `.env.production` templates

`backend/.env.production`:

```env
NODE_ENV=production
PORT=3000

# Core URLs
FRONTEND_URL=https://founderscdi.uz
ADMIN_URL=https://admin.founderscdi.uz
BACKEND_URL=https://api.founderscdi.uz

# Database
DATABASE_URL=postgresql://ielts_app:CHANGE_ME@127.0.0.1:5432/ielts_prod?schema=public&connection_limit=20&pool_timeout=20

# JWT
JWT_SECRET=CHANGE_ME_LONG_RANDOM_SECRET
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=CHANGE_ME_LONG_RANDOM_REFRESH_SECRET
JWT_REFRESH_EXPIRES_IN=30d

# Redis (split)
SESSION_REDIS_URL=redis://:CHANGE_ME_SESSION_REDIS_PASS@127.0.0.1:6379/0
QUEUE_REDIS_URL=redis://:CHANGE_ME_QUEUE_REDIS_PASS@127.0.0.1:6380/0
REDIS_TLS=false

# AI / Queue
GEMINI_API_KEY=CHANGE_ME
AI_EVALUATION_TIMEOUT_MS=45000
AI_MAX_TOTAL_ATTEMPTS=12
DISABLE_WRITING_QUEUE_WORKER=true

# Runtime tuning
HTTP_CLIENT_TIMEOUT_MS=15000
EXAM_PERF_METRICS=true

# Security / feature flags
ENABLE_CHAOS_TESTING=false
CHAOS_TOKEN=CHANGE_ME_CHAOS_TOKEN
UPLOAD_SCAN_COMMAND=
P0_MAX_FALLBACK_RATIO=0.05

# Paths / media
UPLOADS_DIR=/srv/ielts/shared/uploads
MEDIA_BASE_URL=https://api.founderscdi.uz/uploads
```

`frontend/.env.production`:

```env
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://api.founderscdi.uz/api
```

`admin-panel/.env.production`:

```env
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://api.founderscdi.uz/api
```

### 4.2 Build commands and artifact structure

```bash
cd backend && npm ci && npm run build
cd ../frontend && npm ci && npm run build
cd ../admin-panel && npm ci && npm run build
```

Artifacts:

- Backend: `backend/dist/src/main.js`, `backend/dist/src/worker.js`
- Student web: `frontend/.next/standalone`, `frontend/.next/static`
- Admin web: `admin-panel/.next/standalone`, `admin-panel/.next/static`

### 4.3 Release checklist

- Build succeeds in all 3 apps.
- DB migrations run with `prisma migrate deploy`.
- Health endpoints return OK.
- Nginx routes by host are correct.
- Auth and exam runtime flows validated.

---

## Part 5 - Deployment Option A: Docker Compose (Recommended)

### 5.1 `docker-compose.yml`

```yaml
name: ielts-prod

services:
  postgres:
    image: postgres:16
    container_name: ielts-postgres
    restart: unless-stopped
    env_file:
      - ./deploy/env/postgres.env
    volumes:
      - pg_data:/var/lib/postgresql/data
    networks: [internal]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 10s
      timeout: 5s
      retries: 10

  redis-session:
    image: redis:7.2-alpine
    container_name: ielts-redis-session
    restart: unless-stopped
    env_file:
      - ./deploy/env/redis-session.env
    command: ["/bin/sh", "-c", "exec redis-server /usr/local/etc/redis/redis.conf --requirepass \"$REDIS_PASSWORD\""]
    volumes:
      - ./deploy/redis/session.conf:/usr/local/etc/redis/redis.conf:ro
      - redis_session_data:/data
    networks: [internal]
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"$REDIS_PASSWORD\" ping | grep PONG"]
      interval: 10s
      timeout: 5s
      retries: 10

  redis-queue:
    image: redis:7.2-alpine
    container_name: ielts-redis-queue
    restart: unless-stopped
    env_file:
      - ./deploy/env/redis-queue.env
    command: ["/bin/sh", "-c", "exec redis-server /usr/local/etc/redis/redis.conf --requirepass \"$REDIS_PASSWORD\""]
    volumes:
      - ./deploy/redis/queue.conf:/usr/local/etc/redis/redis.conf:ro
      - redis_queue_data:/data
    networks: [internal]
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"$REDIS_PASSWORD\" ping | grep PONG"]
      interval: 10s
      timeout: 5s
      retries: 10

  api:
    image: ielts-api:${IMAGE_TAG:-latest}
    container_name: ielts-api
    build:
      context: ./backend
      dockerfile: Dockerfile
    env_file:
      - ./deploy/env/api.env
    environment:
      NODE_ENV: production
      PORT: 3000
      DISABLE_WRITING_QUEUE_WORKER: "true"
    depends_on:
      postgres:
        condition: service_healthy
      redis-session:
        condition: service_healthy
      redis-queue:
        condition: service_healthy
    volumes:
      - uploads_data:/app/uploads
    networks: [internal]
    restart: unless-stopped

  worker:
    image: ielts-api:${IMAGE_TAG:-latest}
    container_name: ielts-worker
    env_file:
      - ./deploy/env/api.env
    environment:
      NODE_ENV: production
      DISABLE_WRITING_QUEUE_WORKER: "false"
    command: ["node", "dist/src/worker.js"]
    depends_on:
      postgres:
        condition: service_healthy
      redis-queue:
        condition: service_healthy
    volumes:
      - uploads_data:/app/uploads
    networks: [internal]
    restart: unless-stopped

  web:
    image: ielts-web:${IMAGE_TAG:-latest}
    container_name: ielts-web
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL}
    environment:
      NODE_ENV: production
      PORT: 3000
      HOSTNAME: 0.0.0.0
    networks: [internal]
    restart: unless-stopped

  admin:
    image: ielts-admin:${IMAGE_TAG:-latest}
    container_name: ielts-admin
    build:
      context: ./admin-panel
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL}
    environment:
      NODE_ENV: production
      PORT: 3000
      HOSTNAME: 0.0.0.0
    networks: [internal]
    restart: unless-stopped

  nginx:
    image: nginx:1.27-alpine
    container_name: ielts-nginx
    restart: unless-stopped
    depends_on:
      - api
      - web
      - admin
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy/nginx/conf.d:/etc/nginx/conf.d:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
      - /var/www/certbot:/var/www/certbot:ro
      - uploads_data:/var/www/uploads:ro
    networks:
      - internal

networks:
  internal:

volumes:
  pg_data:
  redis_session_data:
  redis_queue_data:
  uploads_data:
```

### 5.2 Dockerfiles (multi-stage)

`backend/Dockerfile`:

```dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
RUN mkdir -p /app/uploads
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
```

`frontend/Dockerfile`:

```dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

`admin-panel/Dockerfile`:

```dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### 5.3 Nginx config (Docker)

`deploy/nginx/conf.d/ielts.conf`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

limit_req_zone $binary_remote_addr zone=login_limit:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=runtime_limit:20m rate=50r/s;
limit_req_zone $binary_remote_addr zone=api_limit:20m rate=20r/s;

upstream api_upstream { server api:3000; keepalive 64; }
upstream web_upstream { server web:3000; keepalive 32; }
upstream admin_upstream { server admin:3000; keepalive 32; }

server {
    listen 80;
    server_name founderscdi.uz admin.founderscdi.uz api.founderscdi.uz;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name founderscdi.uz;

    ssl_certificate /etc/letsencrypt/live/founderscdi.uz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/founderscdi.uz/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

    location / {
        proxy_pass http://web_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
    }
}

server {
    listen 443 ssl http2;
    server_name admin.founderscdi.uz;

    ssl_certificate /etc/letsencrypt/live/admin.founderscdi.uz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.founderscdi.uz/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://admin_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
    }
}

server {
    listen 443 ssl http2;
    server_name api.founderscdi.uz;

    ssl_certificate /etc/letsencrypt/live/api.founderscdi.uz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.founderscdi.uz/privkey.pem;

    client_max_body_size 210m;

    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript application/xml+rss;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location = /api/auth/login {
        limit_req zone=login_limit burst=10 nodelay;
        proxy_pass http://api_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    location ~ ^/api/assignments/.+/(sync|heartbeat|submit|reconnect)$ {
        limit_req zone=runtime_limit burst=200 nodelay;
        proxy_pass http://api_upstream;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_next_upstream error timeout http_502 http_503 http_504;
    }

    location /api/ {
        limit_req zone=api_limit burst=60 nodelay;
        proxy_pass http://api_upstream;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
    }

    location /uploads/ {
        alias /var/www/uploads/;
        autoindex off;
        gzip off;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Access-Control-Allow-Methods "GET,HEAD,OPTIONS" always;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        if ($request_method = OPTIONS) { return 204; }
        try_files $uri =404;
    }
}
```

### 5.4 SSL setup with certbot

```bash
sudo apt install -y certbot
sudo mkdir -p /var/www/certbot
docker compose up -d nginx

sudo certbot certonly --webroot \
  -w /var/www/certbot \
  -d "$DOMAIN" -d "$ADMIN_DOMAIN" -d "$API_DOMAIN" \
  --email "$EMAIL" --agree-tos --no-eff-email

docker compose restart nginx
sudo systemctl enable --now certbot.timer
```

Post-renew hook:

```bash
sudo tee /etc/letsencrypt/renewal-hooks/post/restart-ielts-nginx.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
cd /srv/ielts
docker compose restart nginx
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/post/restart-ielts-nginx.sh
```

### 5.5 Docker commands (deploy/logs/rollback)

```bash
cd /srv/ielts
export IMAGE_TAG="2026-02-15"
export NEXT_PUBLIC_API_URL="https://${API_DOMAIN}/api"

docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs -f api worker web admin nginx
```

Rollback:

```bash
cd /srv/ielts
export IMAGE_TAG="2026-02-14"
docker compose up -d --no-build
```

---

## Part 6 - Deployment Option B: PM2 + Nginx (No Docker)

### 6.1 System user, layout, permissions

```bash
sudo adduser --system --group --home /srv/ielts ielts
sudo mkdir -p /srv/ielts/{releases,shared/uploads,shared/logs,env}
sudo chown -R ielts:ielts /srv/ielts
```

Install Node + PM2:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs build-essential
sudo npm install -g pm2
```

Directory layout:

```text
/srv/ielts/releases/2026-02-15_120000/{backend,frontend,admin-panel}
/srv/ielts/current -> /srv/ielts/releases/2026-02-15_120000
/srv/ielts/shared/uploads
/srv/ielts/env/{backend.env,frontend.env,admin.env}
```

### 6.2 PM2 ecosystem config

`/srv/ielts/current/ecosystem.config.js`:

```js
module.exports = {
  apps: [
    {
      name: "ielts-api",
      cwd: "/srv/ielts/current/backend",
      script: "dist/src/main.js",
      exec_mode: "cluster",
      instances: 2,
      max_memory_restart: "700M",
      env_file: "/srv/ielts/env/backend.env",
      env: { NODE_ENV: "production", PORT: "3000", DISABLE_WRITING_QUEUE_WORKER: "true" }
    },
    {
      name: "ielts-worker",
      cwd: "/srv/ielts/current/backend",
      script: "dist/src/worker.js",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "700M",
      env_file: "/srv/ielts/env/backend.env",
      env: { NODE_ENV: "production", DISABLE_WRITING_QUEUE_WORKER: "false" }
    },
    {
      name: "ielts-web",
      cwd: "/srv/ielts/current/frontend",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3001 -H 127.0.0.1",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "600M",
      env_file: "/srv/ielts/env/frontend.env",
      env: { NODE_ENV: "production" }
    },
    {
      name: "ielts-admin",
      cwd: "/srv/ielts/current/admin-panel",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3002 -H 127.0.0.1",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "600M",
      env_file: "/srv/ielts/env/admin.env",
      env: { NODE_ENV: "production" }
    }
  ]
};
```

Build/start:

```bash
sudo -u ielts -H bash -lc '
cd /srv/ielts/current/backend && npm ci && npm run build && npx prisma migrate deploy
cd /srv/ielts/current/frontend && npm ci && npm run build
cd /srv/ielts/current/admin-panel && npm ci && npm run build
cd /srv/ielts/current && pm2 start ecosystem.config.js && pm2 save
'

sudo -u ielts -H pm2 startup systemd -u ielts --hp /srv/ielts
```

### 6.3 Nginx server blocks (PM2)

Use the same server block logic as Part 5, with upstreams changed to:

```nginx
upstream api_upstream { server 127.0.0.1:3000; }
upstream web_upstream { server 127.0.0.1:3001; }
upstream admin_upstream { server 127.0.0.1:3002; }
```

Uploads alias path (PM2 mode):

```nginx
location /uploads/ {
  alias /srv/ielts/shared/uploads/;
  try_files $uri =404;
  gzip off;
  add_header Access-Control-Allow-Origin "*" always;
  add_header Cache-Control "public, max-age=31536000, immutable" always;
}
```

### 6.4 Let's Encrypt commands

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx \
  -d "$DOMAIN" -d "$ADMIN_DOMAIN" -d "$API_DOMAIN" \
  --agree-tos -m "$EMAIL" --redirect
sudo systemctl enable --now certbot.timer
```

### 6.5 Log rotation

```bash
sudo -u ielts -H pm2 install pm2-logrotate
sudo -u ielts -H pm2 set pm2-logrotate:max_size 50M
sudo -u ielts -H pm2 set pm2-logrotate:retain 14
sudo -u ielts -H pm2 set pm2-logrotate:compress true
```

---

## Part 7 - Security Hardening

### 7.1 Firewall (UFW)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

### 7.2 Fail2ban basics

```bash
sudo apt install -y fail2ban
```

`/etc/fail2ban/jail.d/ielts.conf`:

```ini
[sshd]
enabled = true
bantime = 1h
findtime = 10m
maxretry = 5

[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled = true
findtime = 10m
bantime = 1h
maxretry = 20
```

```bash
sudo systemctl enable --now fail2ban
sudo fail2ban-client status
```

### 7.3 Nginx security headers

Use at minimum:

- `Strict-Transport-Security`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- `Permissions-Policy`

Apply strict CSP only after verifying all Next.js routes/assets.

### 7.4 Secrets handling

- Keep secrets outside git (`/srv/ielts/env/*.env`).
- Ownership `ielts:ielts`, perms `600`.
- Rotate JWT/DB/Redis credentials regularly.

### 7.5 Rate limiting policy

- Strong on login: `/api/auth/login`.
- Relaxed/high for runtime endpoints:
  - `/api/assignments/:id/sync`
  - `/api/assignments/:id/heartbeat`
  - `/api/assignments/:id/submit`
  - `/api/assignments/:id/reconnect`
- Keep Nest + Nginx limits aligned.

### 7.6 Upload/audio hardening

- Restrict to upload path only with `try_files`.
- `client_max_body_size` aligned with backend limit.
- Disable gzip for media.
- Ensure correct MIME types and CORS headers for audio fetch.

---

## Part 8 - Monitoring and Alerting

### 8.1 Health endpoint usage

```bash
curl -fsS "https://${API_DOMAIN}/api/health"
curl -fsS "https://${API_DOMAIN}/api/health/performance"
```

### 8.2 Key metrics

- API latency p95 (especially sync/heartbeat/submit)
- API 4xx/5xx rates
- Redis latency/errors/reconnects
- PostgreSQL connections and lock waits
- Node CPU/memory
- Session fallback ratio from `/api/health/performance`

### 8.3 Practical stacks

Minimum:

- Docker logs or PM2 logs
- Uptime checks (external)
- Netdata on host

Optional advanced:

- Prometheus + Grafana + Loki

Netdata quick install:

```bash
bash <(curl -Ss https://my-netdata.io/kickstart.sh) --stable-channel
```

### 8.4 Alert rules

- API down > 1 minute -> critical
- Redis session down -> critical
- DB down -> critical
- 5xx rate > 1% for 5 min -> warning/critical
- Sync fallback ratio > 5% sustained -> warning

---

## Part 9 - Migration Runbook (Step-by-step)

1. Prepare VPS:

```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone Asia/Tashkent
```

2. Lower DNS TTL to 60 at least 24-48h before cutover.

3. Deploy new stack on VPS and validate internally.

4. Restore DB snapshot to VPS:

```bash
pg_restore -h 127.0.0.1 -U ielts_app -d ielts_prod /path/to/final.dump
```

5. Cut over queue Redis first.

6. For session Redis, cut over only when no active exams:

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM \"ExamAssignment\" WHERE status='IN_PROGRESS';"
```

7. Validate new host before DNS switch:

```bash
curl --resolve "${API_DOMAIN}:443:${VPS_IP}" "https://${API_DOMAIN}/api/health" -k
curl --resolve "${DOMAIN}:443:${VPS_IP}" "https://${DOMAIN}" -k
curl --resolve "${ADMIN_DOMAIN}:443:${VPS_IP}" "https://${ADMIN_DOMAIN}" -k
```

8. DNS cutover:

- Update A/AAAA for web/admin/api to VPS.
- Monitor for 1-2h.

9. Rollback plan:

- Keep old Plesk stack unchanged for at least 48h.
- If incident, repoint DNS to old host.
- If new writes occurred, reconcile DB before reopening old host.

---

## Pre-flight Checklist (PASS/FAIL)

| Check | Command / Evidence | PASS/FAIL |
|---|---|---|
| All builds pass | `npm run build` in backend/frontend/admin | [ ] |
| DB migrations ready | `npx prisma migrate deploy` | [ ] |
| SSL certs issued | `certbot certificates` | [ ] |
| API health OK | `curl https://api.../api/health` | [ ] |
| Redis session reachable | `redis-cli -p 6379 ping` | [ ] |
| Redis queue reachable | `redis-cli -p 6380 ping` | [ ] |
| Backup restore tested | restore test database succeeded | [ ] |
| Active exams drained (for session cutover) | `IN_PROGRESS=0` query | [ ] |
| DNS TTL lowered | DNS provider screenshot/log | [ ] |
| Rollback snapshot taken | latest dump exists | [ ] |

---

## Part 10 - Post-deploy Verification (Exam-specific)

| Verification | Test method | PASS/FAIL |
|---|---|---|
| Student login | login via web + 200 from `/api/auth/login` | [ ] |
| Exam start | assignment enters `IN_PROGRESS` | [ ] |
| Heartbeat stability | no recurrent failures for 10+ minutes | [ ] |
| Sync stability | continuous typing/sync, no conflict storm | [ ] |
| Tab lock behavior | second tab blocked correctly | [ ] |
| Submit + retry safety | repeated submit handled idempotently | [ ] |
| Audio playback | `.opus` via `/uploads` plays correctly | [ ] |
| Admin panel | login + exam/user/results pages work | [ ] |
| CORS | no browser CORS errors for API/media | [ ] |
| Health/perf | `/api/health` and `/api/health/performance` healthy | [ ] |
| Preflight readiness | `npm run preflight:p0 -- --check-api false` passes expected checks | [ ] |

---

## Notes specific to this codebase

- Backend already supports split Redis env vars (`SESSION_REDIS_*`, `QUEUE_REDIS_*`).
- Runtime-critical sync/submit now uses `tabId` and lock checks; keep this behavior enabled in production.
- Keep worker enabled as separate process/container (`DISABLE_WRITING_QUEUE_WORKER=false` for worker only).
- For media efficiency and reduced exam latency jitter, serve `/uploads` directly from Nginx, not through Node when possible.
