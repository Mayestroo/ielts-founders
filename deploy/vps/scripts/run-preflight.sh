#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./deploy/vps/scripts/run-preflight.sh /srv/ielts/current/backend

BACKEND_DIR="${1:-/srv/ielts/current/backend}"

if [[ ! -d "${BACKEND_DIR}" ]]; then
  echo "Backend directory not found: ${BACKEND_DIR}"
  exit 1
fi

cd "${BACKEND_DIR}"
npm run preflight:p0 -- --check-api false
