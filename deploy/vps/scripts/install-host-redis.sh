#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   SESSION_REDIS_PASSWORD=... QUEUE_REDIS_PASSWORD=... ./deploy/vps/scripts/install-host-redis.sh

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)"
  exit 1
fi

if [[ -z "${SESSION_REDIS_PASSWORD:-}" || -z "${QUEUE_REDIS_PASSWORD:-}" ]]; then
  echo "SESSION_REDIS_PASSWORD and QUEUE_REDIS_PASSWORD are required"
  exit 1
fi

apt update
apt install -y redis-server

cat >/etc/redis/redis-session.conf <<EOF
bind 127.0.0.1 ::1
protected-mode yes
port 6379
supervised systemd
daemonize no

requirepass ${SESSION_REDIS_PASSWORD}
rename-command FLUSHALL ""
rename-command FLUSHDB ""

dir /var/lib/redis
dbfilename dump-session.rdb

appendonly yes
appendfilename "appendonly-session.aof"
appendfsync everysec
no-appendfsync-on-rewrite yes

save 900 1
save 300 10
save 60 10000

maxmemory 2gb
maxmemory-policy noeviction
tcp-keepalive 60
timeout 0
EOF

cat >/etc/redis/redis-queue.conf <<EOF
bind 127.0.0.1 ::1
protected-mode yes
port 6380
supervised systemd
daemonize no

requirepass ${QUEUE_REDIS_PASSWORD}
rename-command FLUSHALL ""
rename-command FLUSHDB ""

dir /var/lib/redis
dbfilename dump-queue.rdb

appendonly yes
appendfilename "appendonly-queue.aof"
appendfsync everysec
no-appendfsync-on-rewrite yes

save 900 1
save 300 10
save 60 10000

maxmemory 1gb
maxmemory-policy noeviction
tcp-keepalive 60
timeout 0
EOF

systemctl disable --now redis-server || true
systemctl enable --now redis-server@redis-session
systemctl enable --now redis-server@redis-queue

systemctl status redis-server@redis-session --no-pager
systemctl status redis-server@redis-queue --no-pager

echo "Redis host setup complete"
