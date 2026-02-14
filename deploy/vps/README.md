# VPS Deployment Assets

This folder implements the deployment templates from `vps-migration-plan.md`.

## Structure

- `docker-compose.yml`: Full Docker deployment (nginx + api + web + admin + postgres + dual redis + worker)
- `.env.example`: Compose-level build args (`IMAGE_TAG`, `NEXT_PUBLIC_API_URL`)
- `env/*.example`: Runtime env templates (`api`, `postgres`, `redis-session`, `redis-queue`)
- `redis/*.conf`: Redis runtime tuning for session and queue
- `nginx/conf.d/ielts.conf`: Docker-mode Nginx config
- `nginx/ielts.pm2.conf`: PM2-mode Nginx config
- `pm2/ecosystem.config.js`: PM2 process definitions
- `fail2ban/ielts.conf`: Fail2ban baseline config
- `scripts/*.sh`: host install, backup, restore-test, post-deploy, and UFW helpers

## Option A: Docker Compose

### 1) Prepare env files

```bash
cd deploy/vps
cp .env.example .env
cp env/api.env.example env/api.env
cp env/postgres.env.example env/postgres.env
cp env/redis-session.env.example env/redis-session.env
cp env/redis-queue.env.example env/redis-queue.env
```

Edit values in copied files.

Important:

- Keep Redis passwords consistent between `env/api.env` and `env/redis-*.env`.
- `SESSION_REDIS_URL` should point to `redis-session` and `QUEUE_REDIS_URL` to `redis-queue`.

### 2) Build and run

```bash
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env build --pull
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env up -d
docker compose -f deploy/vps/docker-compose.yml ps
```

### 3) Logs

```bash
docker compose -f deploy/vps/docker-compose.yml logs -f api worker web admin nginx
```

### 4) Migrations (inside api container)

```bash
docker compose -f deploy/vps/docker-compose.yml exec api npm run prisma:deploy
```

### 5) Rollback by image tag

Update `IMAGE_TAG` in `deploy/vps/.env` and redeploy:

```bash
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env up -d
```

## Option B: PM2 + Nginx (no Docker)

1. Use `deploy/vps/pm2/ecosystem.config.js` as template at `/srv/ielts/current/ecosystem.config.js`.
2. Copy `deploy/vps/nginx/ielts.pm2.conf` to `/etc/nginx/sites-available/ielts.conf`, then symlink into `sites-enabled`.
3. Copy `deploy/vps/fail2ban/ielts.conf` to `/etc/fail2ban/jail.d/ielts.conf`.

## Host bootstrap helpers

Make scripts executable before use:

```bash
chmod +x deploy/vps/scripts/*.sh
```

Redis (host-managed):

```bash
sudo SESSION_REDIS_PASSWORD='...' QUEUE_REDIS_PASSWORD='...' ./deploy/vps/scripts/install-host-redis.sh
```

Postgres (host-managed):

```bash
sudo DB_NAME=ielts_prod DB_USER=ielts_app DB_PASSWORD='...' ./deploy/vps/scripts/install-host-postgres.sh
```

UFW setup:

```bash
sudo ./deploy/vps/scripts/setup-ufw.sh
```

## Backup and verification

Backup:

```bash
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=ielts_app PGPASSWORD='...' PGDATABASE=ielts_prod \
  ./deploy/vps/scripts/pg_backup.sh
```

Restore test:

```bash
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=ielts_app PGPASSWORD='...' \
  ./deploy/vps/scripts/restore_test.sh /srv/backups/postgres/ielts_prod_YYYY-MM-DD_HH-MM-SS.dump
```

Post-deploy endpoint checks:

```bash
API_URL=https://api.founderscdi.uz WEB_URL=https://founderscdi.uz ADMIN_URL=https://admin.founderscdi.uz \
  ./deploy/vps/scripts/postdeploy-check.sh
```
