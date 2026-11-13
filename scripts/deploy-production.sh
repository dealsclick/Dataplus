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
  run_with_timeout "${DATAPLUS_DEPLOY_STATUS_TIMEOUT_SECONDS:-90}" docker compose run --rm --no-deps \
    dataplus node scripts/write-deployment-status.js "$status" "$DEPLOY_REVISION" "$DEPLOY_STARTED_AT"
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift
  timeout --signal=TERM --kill-after=15s "${timeout_seconds}s" "$@"
}

run_optional_maintenance() {
  local label="$1"
  local timeout_seconds="$2"
  shift 2
  if ! run_with_timeout "$timeout_seconds" "$@"; then
    echo "Warning: $label did not finish within ${timeout_seconds}s. Production is healthy; this maintenance can be retried separately." >&2
  fi
}

resume_label_purchases() {
  run_with_timeout "${DATAPLUS_LABEL_GATE_TIMEOUT_SECONDS:-90}" docker compose run --rm --no-deps \
    dataplus node scripts/wait-for-label-purchases.cjs --resume
}

deployment_failed() {
  resume_label_purchases || true
  record_deployment_status failed || true
}

trap deployment_failed ERR

echo "Building DataPlus application images..."
docker compose build

PRESERVE_BACKGROUND_WORKER=false
if [[ "$(docker inspect -f '{{.State.Running}}' dataplus-worker-background 2>/dev/null || true)" == "true" ]]; then
  ACTIVE_PRODUCT_DUMP="$(docker exec dataplus-postgres psql -U postgres -d dataplus -Atqc \
    "select 1 from operations_jobs where lower(status)='running' and coalesce(raw->>'workerTask','')='product-dump-import' and coalesce(raw->>'workerLane','')='background' limit 1" 2>/dev/null || true)"
  if [[ "$ACTIVE_PRODUCT_DUMP" == "1" ]]; then
    PRESERVE_BACKGROUND_WORKER=true
    echo "An active product datadump owns worker-background; preserving that container until the import finishes."
  fi
fi

echo "Stopping paused TikTok and retired Walmart worker lanes..."
docker compose stop worker-orders-tiktok worker-walmart || true
docker compose rm -f worker-orders-tiktok worker-walmart || true

echo "Pausing new label purchases and draining active purchase jobs..."
run_with_timeout "${DATAPLUS_LABEL_GATE_TIMEOUT_SECONDS:-360}" docker compose run --rm --no-deps \
  dataplus node scripts/wait-for-label-purchases.cjs --pause --timeout-seconds "${DATAPLUS_LABEL_DRAIN_TIMEOUT_SECONDS:-300}"

echo "Generating release history from the checked-out repository..."
run_with_timeout "${DATAPLUS_RELEASE_HISTORY_TIMEOUT_SECONDS:-120}" docker compose run --rm --no-deps \
  -v "$PWD/.git:/app/.git:ro" \
  dataplus node scripts/generate-release-history.js

record_deployment_status deploying

echo "Starting production services and waiting for health checks..."
DEPLOY_SERVICES=(redis postgres dataplus worker worker-orders-shopify worker-carrier worker-orders-ebay worker-orders-temu)
if [[ "$PRESERVE_BACKGROUND_WORKER" != "true" ]]; then
  DEPLOY_SERVICES+=(worker-background)
fi
run_with_timeout "${DATAPLUS_SERVICE_START_TIMEOUT_SECONDS:-300}" docker compose up -d --build --remove-orphans --wait --wait-timeout 180 "${DEPLOY_SERVICES[@]}"
docker compose ps
curl --fail --silent --show-error http://127.0.0.1:4173/ > /dev/null
record_deployment_status healthy
resume_label_purchases
trap - ERR

echo "DataPlus production deployment is healthy."

echo "Running bounded post-deploy maintenance..."
echo "Reconciling historical source-completed orders (one-time migration)..."
run_optional_maintenance "source-completed order reconciliation" "${DATAPLUS_DEPLOY_MAINTENANCE_TIMEOUT_SECONDS:-60}" docker compose run --rm --no-deps \
  dataplus node scripts/reconcile-source-completed-orders.js --apply --once

echo "Reconciling retained Temu label estimates and settlement matches..."
run_optional_maintenance "Temu shipping-cost reconciliation" "${DATAPLUS_DEPLOY_MAINTENANCE_TIMEOUT_SECONDS:-60}" docker compose run --rm --no-deps \
  dataplus node scripts/repair-temu-shipping-costs.cjs --apply

echo "Compacting redundant no-change routing job history..."
run_optional_maintenance "routing job history compaction" "${DATAPLUS_DEPLOY_MAINTENANCE_TIMEOUT_SECONDS:-60}" docker compose run --rm --no-deps \
  dataplus node scripts/prune-redundant-routing-jobs.cjs
