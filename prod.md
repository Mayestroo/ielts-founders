# Production Deployment (Contabo VPS)

This project supports a full production deployment via Docker Compose.

Target domains (example):

- Student web: `https://founderscdi.uz`
- Admin web: `https://admin.founderscdi.uz`
- API: `https://api.founderscdi.uz` (backend serves under `/api/*`)

The recommended setup uses `deploy/vps/docker-compose.yml`:

- Postgres 16 (container)
- Redis session (container)
- Redis queue (container)
- Backend API (container)
- Worker (container)
- Student Next.js app (container)
- Admin Next.js app (container)
- Nginx reverse proxy + TLS (container)

---

## 0) Prerequisites

1. Contabo VPS: Ubuntu 24.04 LTS recommended.
2. DNS:
   - Create A records pointing to the VPS public IP:
     - `founderscdi.uz`
     - `admin.founderscdi.uz`
     - `api.founderscdi.uz`
   - Wait until `ping` / `dig` resolves to the VPS IP.
3. You have the database backup file (PostgreSQL custom dump). Example from your host:
   - `download_host7685_.../backup/database/host7685_ielts.tar`
   - Note: it is a **PostgreSQL custom dump** (use `pg_restore`), despite the `.tar` name.

---

## 1) Bootstrap the VPS

SSH into the VPS and run:

```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone Asia/Tashkent

# Tools
sudo apt install -y git curl ca-certificates ufw

# Docker (Ubuntu packages)
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker

# Optional: certbot (we use standalone issuance below)
sudo apt install -y certbot
```

Firewall (ports 22/80/443 only):

```bash
cd /srv || true

# If you are inside the repo, you can run the helper:
# sudo /srv/ielts/deploy/vps/scripts/setup-ufw.sh

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status verbose
```

---

## 2) Clone the repository

```bash
sudo mkdir -p /srv/ielts
sudo chown -R "$USER:$USER" /srv/ielts

git clone <YOUR_GIT_REPO_URL> /srv/ielts
cd /srv/ielts
```

---

## 3) Prepare deployment environment files

All Docker deployment files live in `deploy/vps/`.

### 3.1 Create compose-level env

Create `deploy/vps/.env` (this file is gitignored via `deploy/.gitignore`):

```bash
cat > deploy/vps/.env <<'EOF'
IMAGE_TAG=latest
NEXT_PUBLIC_API_URL=https://api.founderscdi.uz/api
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<GOOGLE_WEB_CLIENT_ID>.apps.googleusercontent.com
EOF
```

Important:

- `NEXT_PUBLIC_API_URL` is compiled into both Next.js frontends at build time.

### 3.2 Create runtime env files

Create these files (they are gitignored via `deploy/.gitignore`):

- `deploy/vps/env/api.env`
- `deploy/vps/env/postgres.env`
- `deploy/vps/env/redis-session.env`
- `deploy/vps/env/redis-queue.env`

If you still have the `*.example` templates in the repo, you can copy them:

```bash
cp deploy/vps/env/api.env.example deploy/vps/env/api.env
cp deploy/vps/env/postgres.env.example deploy/vps/env/postgres.env
cp deploy/vps/env/redis-session.env.example deploy/vps/env/redis-session.env
cp deploy/vps/env/redis-queue.env.example deploy/vps/env/redis-queue.env
```

Generate secrets (examples):

```bash
# JWT secrets
openssl rand -hex 64
openssl rand -hex 64

# Redis passwords
openssl rand -hex 24
openssl rand -hex 24
```

Now edit these files:

1) `deploy/vps/env/postgres.env`

```env
POSTGRES_DB=ielts_prod
POSTGRES_USER=ielts_app
POSTGRES_PASSWORD=<DB_PASSWORD>
```

2) `deploy/vps/env/redis-session.env`

```env
REDIS_PASSWORD=<SESSION_REDIS_PASSWORD>
```

3) `deploy/vps/env/redis-queue.env`

```env
REDIS_PASSWORD=<QUEUE_REDIS_PASSWORD>
```

4) `deploy/vps/env/api.env` (add missing vars if not present)

```env
NODE_ENV=production
PORT=3000

FRONTEND_URL=https://founderscdi.uz
ADMIN_URL=https://admin.founderscdi.uz
BACKEND_URL=https://api.founderscdi.uz

DATABASE_URL=postgresql://ielts_app:<DB_PASSWORD>@postgres:5432/ielts_prod?schema=public

JWT_SECRET=<LONG_RANDOM>
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=<LONG_RANDOM>
JWT_REFRESH_EXPIRES_IN=30d

SESSION_REDIS_URL=redis://:<SESSION_REDIS_PASSWORD>@redis-session:6379/0
QUEUE_REDIS_URL=redis://:<QUEUE_REDIS_PASSWORD>@redis-queue:6379/0
SESSION_REDIS_TLS=false
QUEUE_REDIS_TLS=false
ALLOW_SHARED_REDIS=false

# Google auth (must match frontend)
GOOGLE_CLIENT_ID=<GOOGLE_WEB_CLIENT_ID>.apps.googleusercontent.com

# Optional: default center assignment for new students
DEFAULT_STUDENT_CENTER_ID=<CENTER_UUID>
GOOGLE_DEFAULT_CENTER_ID=<CENTER_UUID>

# AI
GEMINI_API_KEY=<YOUR_GEMINI_KEYS>

# Optional tuning
EXAM_SYNC_CHECKPOINT_EVERY=48
EXAM_PERF_METRICS=true
HTTP_CLIENT_TIMEOUT_MS=15000
AI_EVALUATION_TIMEOUT_MS=45000
AI_MAX_TOTAL_ATTEMPTS=12
P0_MAX_FALLBACK_RATIO=0.05
```

Notes:

- The database password in `DATABASE_URL` must match `POSTGRES_PASSWORD`.
- Redis passwords must match the URLs.
- `DEFAULT_STUDENT_CENTER_ID` is recommended if you have multiple centers.
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` must be set in `deploy/vps/.env` so the student frontend can render the Google sign-in button.

---

## 4) Start the stack (without Nginx first)

Start only Postgres + Redis first (keeps the API from connecting while you restore).

```bash
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env up -d postgres redis-session redis-queue
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env ps
```

---

## 5) Restore your existing database backup

### 5.1 Upload the dump to the VPS

From your local machine:

```bash
scp host7685_ielts.tar <ssh-user>@<vps-ip>:/srv/ielts/host7685_ielts.dump
```

### 5.2 Restore into the Postgres container

```bash
# Copy dump into the postgres container
docker cp /srv/ielts/host7685_ielts.dump ielts-postgres:/tmp/host7685_ielts.dump

# Restore (custom dump -> use pg_restore)
docker exec -it ielts-postgres \
  pg_restore -U ielts_app -d ielts_prod --clean --if-exists --no-owner /tmp/host7685_ielts.dump
```

If you want to inspect the dump before restoring:

```bash
docker exec -it ielts-postgres pg_restore --list /tmp/host7685_ielts.dump | head -n 50
```

---

## 6) Start API / Worker / Web / Admin

```bash
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env up -d --build api worker web admin
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env ps
```

---

## 7) Run Prisma migrations

After restore, apply schema migrations from the current code:

```bash
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env exec api npm run prisma:deploy
```

---

## 8) (Optional) Migrate uploads

If your old server has uploaded media (audio/images) in backend `uploads/`, migrate them.

Example approach:

1) Copy old uploads to VPS:

```bash
rsync -avz <old-host>:/path/to/uploads/ /srv/ielts/uploads/
```

2) Copy into the docker volume `uploads_data`:

```bash
docker run --rm \
  -v ielts-prod_uploads_data:/data \
  -v /srv/ielts/uploads:/src:ro \
  alpine sh -c 'cp -a /src/. /data/'
```

---

## 9) Issue SSL certificates (LetsEncrypt)

The Nginx container expects certs at:

- `/etc/letsencrypt/live/founderscdi.uz/...`
- `/etc/letsencrypt/live/admin.founderscdi.uz/...`
- `/etc/letsencrypt/live/api.founderscdi.uz/...`

Issue certs using standalone mode (port 80 must be free).

```bash
sudo certbot certonly --standalone -d founderscdi.uz
sudo certbot certonly --standalone -d admin.founderscdi.uz
sudo certbot certonly --standalone -d api.founderscdi.uz
```

---

## 10) Start Nginx

```bash
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env up -d nginx
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env ps
```

---

## 11) Verify deployment

```bash
curl -fsS https://api.founderscdi.uz/api/health
curl -fsS https://founderscdi.uz
curl -fsS https://admin.founderscdi.uz
```

Or use the built-in script:

```bash
API_URL=https://api.founderscdi.uz WEB_URL=https://founderscdi.uz ADMIN_URL=https://admin.founderscdi.uz \
  ./deploy/vps/scripts/postdeploy-check.sh
```

Logs:

```bash
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env logs -f api worker nginx
```

---

## 12) TLS auto-renew (cron)

Because certs were issued in standalone mode, renewals need port 80.
The simplest approach is to stop Nginx briefly during renew.

Edit root crontab:

```bash
sudo crontab -e
```

Add:

```cron
0 3 * * * docker compose -f /srv/ielts/deploy/vps/docker-compose.yml --env-file /srv/ielts/deploy/vps/.env stop nginx && certbot renew --quiet && docker compose -f /srv/ielts/deploy/vps/docker-compose.yml --env-file /srv/ielts/deploy/vps/.env start nginx
```

---

## 13) Updating the application

```bash
cd /srv/ielts
git pull

docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env build --pull
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env up -d

docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env exec api npm run prisma:deploy
```

---

## 14) Backups (recommended)

Create a daily DB backup from the Postgres container:

```bash
sudo mkdir -p /srv/backups/postgres

DATE="$(date +%F_%H-%M-%S)"
docker exec -e PGPASSWORD='<DB_PASSWORD>' ielts-postgres \
  pg_dump -U ielts_app -d ielts_prod -Fc \
  > "/srv/backups/postgres/ielts_prod_${DATE}.dump"
```

Retention example (keep 14 days):

```bash
find /srv/backups/postgres -type f -name "*.dump" -mtime +14 -delete
```

---

## Notes / Common issues

- If Nginx fails to start, it is usually missing LetsEncrypt cert files.
- If Google auth button doesn't render, ensure `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set in `deploy/vps/.env` and `GOOGLE_CLIENT_ID` is set in `deploy/vps/env/api.env`.
- If you restore a dump into an already-used Postgres volume and want to restart fresh, remove the volume:

```bash
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env down
docker volume rm ielts-prod_pg_data
```
