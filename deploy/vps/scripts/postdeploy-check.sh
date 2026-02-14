#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   API_URL="https://api.founderscdi.uz" \
#   WEB_URL="https://founderscdi.uz" \
#   ADMIN_URL="https://admin.founderscdi.uz" \
#   ./deploy/vps/scripts/postdeploy-check.sh

API_URL="${API_URL:-https://api.founderscdi.uz}"
WEB_URL="${WEB_URL:-https://founderscdi.uz}"
ADMIN_URL="${ADMIN_URL:-https://admin.founderscdi.uz}"

check_url() {
  local url="$1"
  local name="$2"

  if curl -fsS --max-time 15 "$url" >/dev/null; then
    echo "[PASS] ${name}: ${url}"
  else
    echo "[FAIL] ${name}: ${url}"
    return 1
  fi
}

check_url "${WEB_URL}" "student web"
check_url "${ADMIN_URL}" "admin web"
check_url "${API_URL}/api/health" "api health"
check_url "${API_URL}/api/health/performance" "api performance"

echo "All post-deploy checks passed"
