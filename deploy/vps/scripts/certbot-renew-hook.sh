#!/usr/bin/env bash
set -euo pipefail

# Docker mode
if command -v docker >/dev/null 2>&1; then
  cd /srv/ielts
  docker compose -f deploy/vps/docker-compose.yml restart nginx
fi

# Host Nginx mode
if command -v systemctl >/dev/null 2>&1; then
  systemctl reload nginx || true
fi
