#!/usr/bin/env bash
set -euo pipefail

cd "${DATAPLUS_ROOT:-/root/dataplus}"
mkdir -p generated
TARGET_REVISION="${DATAPLUS_DEPLOY_REVISION:-}"
if [[ -n "$TARGET_REVISION" ]]; then
  [[ "$TARGET_REVISION" =~ ^[0-9a-f]{40}$ ]]
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "Production has tracked local changes. Deployment stopped before changing revisions." >&2
    git status --short --untracked-files=no >&2
    exit 1
  fi

  git fetch origin "$TARGET_REVISION"
  git cat-file -e "$TARGET_REVISION^{commit}"
  CURRENT_REVISION="$(git rev-parse HEAD)"
  if [[ "$CURRENT_REVISION" != "$TARGET_REVISION" ]]; then
    BACKUP_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
    BACKUP_ROOT="${DATAPLUS_DEPLOY_BACKUP_ROOT:-/root/dataplus-deployment-backups}"
    BACKUP_REF="deployment-backup/${BACKUP_STAMP}-${CURRENT_REVISION:0:12}"
    mkdir -p "$BACKUP_ROOT"
    git branch "$BACKUP_REF" "$CURRENT_REVISION"
    git bundle create "$BACKUP_ROOT/${BACKUP_STAMP}-${CURRENT_REVISION:0:12}.bundle" "$BACKUP_REF"
    echo "Saved prior production revision $CURRENT_REVISION as $BACKUP_REF."
    git checkout --detach "$TARGET_REVISION"
  fi
  [[ "$(git rev-parse HEAD)" == "$TARGET_REVISION" ]]
fi

DEPLOY_REVISION="$(git rev-parse HEAD)"
DEPLOY_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

record_deployment_status() {
  local status="$1"
  docker compose run --rm --no-deps \
    dataplus node scripts/write-deployment-status.js "$status" "$DEPLOY_REVISION" "$DEPLOY_STARTED_AT"
}

deployment_failed() {
  record_deployment_status failed || true
}

trap deployment_failed ERR

echo "Building DataPlus application images..."
docker compose build

echo "Generating release history from the checked-out repository..."
docker compose run --rm --no-deps \
  -v "$PWD/.git:/app/.git:ro" \
  dataplus node scripts/generate-release-history.js

record_deployment_status deploying

echo "Reconciling historical source-completed orders (one-time migration)..."
docker compose run --rm --no-deps \
  dataplus node scripts/reconcile-source-completed-orders.js --apply --once

echo "Starting production services and waiting for health checks..."
docker compose up -d --build --remove-orphans --wait --wait-timeout 180
docker compose ps
curl --fail --silent --show-error http://127.0.0.1:4173/ > /dev/null
record_deployment_status healthy
trap - ERR

echo "DataPlus production deployment is healthy."
