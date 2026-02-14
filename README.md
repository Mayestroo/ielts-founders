# IELTS Mock Exam Platform

Production IELTS mock exam system with:

- `backend`: NestJS + Prisma + Redis
- `frontend`: student exam app (Next.js)
- `admin-panel`: admin/teacher app (Next.js)

## Production Documentation

- Deployment guide: `deploy/vps/README.md`
- Migration runbook: `deploy/vps/runbook.md`
- Pre-flight and post-deploy checks: `deploy/vps/checklists.md`

## Additional Operational Docs

- Full migration plan and rationale: `vps-migration-plan.md`
- Load testing harness: `backend/scripts/load/README.md`

## Quick Start (Local)

```bash
# backend
cd backend && npm install && npm run build

# frontend
cd ../frontend && npm install && npm run build

# admin panel
cd ../admin-panel && npm install && npm run build
```
