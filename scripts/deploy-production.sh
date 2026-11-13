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

resume_label_purchases() {
  run_with_timeout "${DATAPLUS_LABEL_GATE_TIMEOUT_SECONDS:-90}" docker compose run --rm --no-deps \
    dataplus node scripts/wait-for-label-purchases.cjs --resume
}

deployment_failed() {
  resume_label_purchases || true
  record_deployment_status failed || true
}

trap deployment_failed ERR

cleanup_stale_deployment_helpers() {
  local container_id command
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    command="$(docker inspect -f '{{json .Config.Cmd}}' "$container_id" 2>/dev/null || true)"
    case "$command" in
      *wait-for-label-purchases.cjs*|*generate-release-history.js*|*write-deployment-status.js*|*prepare-runtime-schema.cjs*|*reconcile-source-completed-orders.js*|*repair-temu-shipping-costs.cjs*|*prune-redundant-routing-jobs.cjs*)
        echo "Removing abandoned deployment helper $container_id: $command"
        docker rm -f "$container_id" >/dev/null
        ;;
    esac
  done < <(docker ps -aq \
    --filter label=com.docker.compose.project=dataplus \
    --filter label=com.docker.compose.service=dataplus \
    --filter label=com.docker.compose.oneoff=True)
}

wait_for_dataplus_api() {
  local timeout_seconds="${1:-90}"
  local deadline=$((SECONDS + timeout_seconds))
  local status
  while (( SECONDS < deadline )); do
    status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 10 \
      http://127.0.0.1:4173/api/auth/session 2>/dev/null || true)"
    if [[ "$status" == "200" || "$status" == "401" ]]; then
      echo "DataPlus API is responsive (HTTP $status)."
      return 0
    fi
    sleep 3
  done
  echo "DataPlus API did not become responsive within ${timeout_seconds}s." >&2
  return 1
}

wait_for_carrier_worker() {
  local timeout_seconds="${1:-120}"
  local deadline=$((SECONDS + timeout_seconds))
  local online
  while (( SECONDS < deadline )); do
    online="$(run_with_timeout 10 docker exec dataplus-postgres psql -U postgres -d dataplus -Atqc \
      "select case when coalesce(nullif(data->>'lastSeenAt','')::timestamptz, 'epoch'::timestamptz) > now() - interval '60 seconds' then 1 else 0 end from state_documents where doc_key='workerHeartbeat.carrier' limit 1" \
      2>/dev/null || true)"
    if [[ "$online" == "1" ]]; then
      echo "Fulfillment carrier worker heartbeat is current."
      return 0
    fi
    sleep 3
  done
  echo "Fulfillment carrier worker did not publish a current heartbeat within ${timeout_seconds}s." >&2
  return 1
}

echo "Cleaning abandoned deployment helpers from earlier interrupted releases..."
cleanup_stale_deployment_helpers

echo "Building DataPlus application images..."
docker compose build

echo "Preparing the runtime database schema once before the service fleet restarts..."
run_with_timeout "${DATAPLUS_SCHEMA_READY_TIMEOUT_SECONDS:-300}" docker compose run --rm --no-deps \
  -e PGAPPNAME=dataplus-deploy-schema \
  dataplus node scripts/prepare-runtime-schema.cjs

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
wait_for_dataplus_api "${DATAPLUS_API_READY_TIMEOUT_SECONDS:-90}"
wait_for_carrier_worker "${DATAPLUS_CARRIER_READY_TIMEOUT_SECONDS:-120}"
record_deployment_status healthy
resume_label_purchases
trap - ERR

echo "DataPlus production deployment is healthy."
