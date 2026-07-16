#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${DATAPLUS_APP_DIR:-/root/dataplus}"
BACKUP_DIR="${DATAPLUS_BACKUP_DIR:-$APP_DIR/backups}"
RETENTION_DAYS="${DATAPLUS_BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
CONTAINER="${DATAPLUS_POSTGRES_CONTAINER:-dataplus-postgres}"
DATABASE="${DATAPLUS_POSTGRES_DATABASE:-dataplus}"
USER="${DATAPLUS_POSTGRES_USER:-postgres}"
OUT="$BACKUP_DIR/dataplus-postgres-$STAMP.dump"

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"

if ! docker compose ps postgres --status running >/dev/null 2>&1; then
  echo "postgres container is not running" >&2
  exit 1
fi

docker exec "$CONTAINER" pg_dump \
  -U "$USER" \
  -d "$DATABASE" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file="/tmp/dataplus-postgres-$STAMP.dump"

docker cp "$CONTAINER:/tmp/dataplus-postgres-$STAMP.dump" "$OUT"
docker exec "$CONTAINER" rm -f "/tmp/dataplus-postgres-$STAMP.dump"

sha256sum "$OUT" > "$OUT.sha256"

find "$BACKUP_DIR" -type f \( -name 'dataplus-postgres-*.dump' -o -name 'dataplus-postgres-*.dump.sha256' \) -mtime +"$RETENTION_DAYS" -delete

ls -lh "$OUT"
