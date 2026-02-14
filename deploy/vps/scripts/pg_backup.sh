#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   BACKUP_DIR=/srv/backups/postgres \
#   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=ielts_app PGPASSWORD=secret PGDATABASE=ielts_prod \
#   RETENTION_DAYS=14 \
#   ./deploy/vps/scripts/pg_backup.sh

BACKUP_DIR="${BACKUP_DIR:-/srv/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ -z "${PGHOST:-}" || -z "${PGPORT:-}" || -z "${PGUSER:-}" || -z "${PGPASSWORD:-}" || -z "${PGDATABASE:-}" ]]; then
  echo "PGHOST, PGPORT, PGUSER, PGPASSWORD, and PGDATABASE must be set"
  exit 1
fi

DATE="$(date +%F_%H-%M-%S)"
OUTPUT="${BACKUP_DIR}/${PGDATABASE}_${DATE}.dump"

mkdir -p "${BACKUP_DIR}"

echo "Creating backup: ${OUTPUT}"
pg_dump -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -Fc > "${OUTPUT}"

echo "Applying retention policy: ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -type f -name "*.dump" -mtime +"${RETENTION_DAYS}" -delete

echo "Backup complete"
