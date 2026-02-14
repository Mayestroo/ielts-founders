#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   DB_NAME=ielts_prod DB_USER=ielts_app DB_PASSWORD=... ./deploy/vps/scripts/install-host-postgres.sh

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo)"
  exit 1
fi

DB_NAME="${DB_NAME:-ielts_prod}"
DB_USER="${DB_USER:-ielts_app}"

if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "DB_PASSWORD is required"
  exit 1
fi

apt update
apt install -y postgresql postgresql-contrib

systemctl enable --now postgresql

ROLE_EXISTS="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")"
if [[ "${ROLE_EXISTS}" != "1" ]]; then
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE;"
else
  sudo -u postgres psql -c "ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';"
fi

DB_EXISTS="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")"
if [[ "${DB_EXISTS}" != "1" ]]; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi

sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"

PG_VER="$(ls /etc/postgresql | sort -V | tail -n1)"
PG_CONF="/etc/postgresql/${PG_VER}/main/postgresql.conf"
PG_HBA="/etc/postgresql/${PG_VER}/main/pg_hba.conf"

sed -i "s/^#listen_addresses.*/listen_addresses = '127.0.0.1'/" "${PG_CONF}"

cat >"${PG_HBA}" <<'EOF'
local   all             postgres                                peer
local   all             all                                     scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
EOF

systemctl restart postgresql

echo "PostgreSQL host setup complete"
