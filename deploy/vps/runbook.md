# VPS Migration Runbook

## 1) Prepare VPS

```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone Asia/Tashkent
```

## 2) Clone and prepare files

```bash
git clone <repo-url> /srv/ielts
cd /srv/ielts

cp deploy/vps/.env.example deploy/vps/.env
cp deploy/vps/env/api.env.example deploy/vps/env/api.env
cp deploy/vps/env/postgres.env.example deploy/vps/env/postgres.env
cp deploy/vps/env/redis-session.env.example deploy/vps/env/redis-session.env
cp deploy/vps/env/redis-queue.env.example deploy/vps/env/redis-queue.env
```

## 3) Deploy (Docker option)

```bash
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env build --pull
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env up -d
docker compose -f deploy/vps/docker-compose.yml exec api npm run prisma:deploy
```

## 4) Verify baseline health

```bash
API_URL=https://api.founderscdi.uz WEB_URL=https://founderscdi.uz ADMIN_URL=https://admin.founderscdi.uz \
  ./deploy/vps/scripts/postdeploy-check.sh

docker compose -f deploy/vps/docker-compose.yml logs -f api worker nginx
```

## 5) Redis cutover sequence

1. Cut queue Redis first.
2. For session Redis cutover, ensure no active exams:

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS in_progress FROM \"ExamAssignment\" WHERE status='IN_PROGRESS';"
```

3. Switch session env to VPS Redis.
4. Restart API + worker.
5. Re-run health + preflight checks.

## 6) DNS cutover

1. Lower TTL (60) at least 24h before.
2. Update A/AAAA for web/admin/api.
3. Monitor for 1-2 hours.

## 7) Rollback

- Keep old host running for at least 48h.
- DNS rollback to old IP if critical issue.
- If writes happened on VPS, reconcile DB before reopening old host.
