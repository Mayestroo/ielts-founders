# VPS Migration Checklists

## Pre-flight (before DNS cutover)

- [ ] `backend`: `npm run build` passes
- [ ] `frontend`: `npm run build` passes
- [ ] `admin-panel`: `npm run build` passes
- [ ] `backend`: `npm run prisma:deploy` passes
- [ ] `backend`: `npm run preflight:p0 -- --check-api false` passes
- [ ] SSL certs issued (`certbot certificates`)
- [ ] Session Redis reachable (`redis-cli ... -p 6379 ping`)
- [ ] Queue Redis reachable (`redis-cli ... -p 6380 ping`)
- [ ] Postgres backup created and restore-tested
- [ ] Active exams drained for session-redis cutover
- [ ] DNS TTL lowered (60s)
- [ ] Rollback snapshot taken

## Post-deploy (exam-specific)

- [ ] Student login works
- [ ] Exam start works
- [ ] Heartbeat stable for 10+ min
- [ ] Sync stable for 10+ min
- [ ] Tab lock behavior blocks second-tab conflict
- [ ] Submit works and remains idempotent on retry
- [ ] `.opus` playback from `/uploads` works
- [ ] Admin panel login + CRUD works
- [ ] No browser CORS errors
- [ ] API health/perf endpoints healthy

## Suggested smoke commands

```bash
API_URL=https://api.founderscdi.uz WEB_URL=https://founderscdi.uz ADMIN_URL=https://admin.founderscdi.uz \
  ./deploy/vps/scripts/postdeploy-check.sh

cd backend
npm run preflight:p0 -- --check-api false
```
