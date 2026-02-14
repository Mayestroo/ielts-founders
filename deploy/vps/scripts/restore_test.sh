#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=ielts_app PGPASSWORD=secret \
#   TARGET_DB=ielts_restore_test \
#   ./deploy/vps/scripts/restore_test.sh /srv/backups/postgres/ielts_prod_xxx.dump

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <dump-file>"
  exit 1
fi

DUMP_FILE="$1"
TARGET_DB="${TARGET_DB:-ielts_restore_test}"

if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "Dump file not found: ${DUMP_FILE}"
  exit 1
fi

if [[ -z "${PGHOST:-}" || -z "${PGPORT:-}" || -z "${PGUSER:-}" || -z "${PGPASSWORD:-}" ]]; then
  echo "PGHOST, PGPORT, PGUSER, and PGPASSWORD must be set"
  exit 1
fi

echo "Recreating test restore database: ${TARGET_DB}"
dropdb -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" --if-exists "${TARGET_DB}"
createdb -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" "${TARGET_DB}"

echo "Restoring: ${DUMP_FILE}"
pg_restore -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${TARGET_DB}" "${DUMP_FILE}"

echo "Restore test complete"
