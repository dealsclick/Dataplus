#!/usr/bin/env bash
set -euo pipefail

PRODUCT_DUMP_JOB_ID="${1:-}"
PRESERVED_WORKER_ID="${2:-}"
DATAPLUS_ROOT="${DATAPLUS_ROOT:-/root/dataplus}"
WAIT_SECONDS="${DATAPLUS_BACKGROUND_HANDOFF_WAIT_SECONDS:-2}"
TIMEOUT_SECONDS="${DATAPLUS_BACKGROUND_HANDOFF_TIMEOUT_SECONDS:-86400}"

[[ "$PRODUCT_DUMP_JOB_ID" =~ ^[0-9a-fA-F-]{36}$ ]]
[[ "$PRESERVED_WORKER_ID" =~ ^[A-Za-z0-9._:-]+$ ]]
cd "$DATAPLUS_ROOT"

exec 9>/tmp/dataplus-background-worker-handoff.lock
if ! flock -n 9; then
  echo "Another preserved background-worker handoff is already waiting."
  exit 0
fi

deadline=$((SECONDS + TIMEOUT_SECONDS))
echo "Waiting for product datadump job $PRODUCT_DUMP_JOB_ID before replacing $PRESERVED_WORKER_ID."
while (( SECONDS < deadline )); do
  status="$(docker exec dataplus-postgres psql -U postgres -d dataplus -Atq \
    -v job_id="$PRODUCT_DUMP_JOB_ID" \
    -c "select lower(status) from operations_jobs where job_id = :'job_id' limit 1" 2>/dev/null || true)"
  if [[ -n "$status" && "$status" != "running" ]]; then
    echo "Product datadump job is now ${status:-missing}; handing the background lane to the deployed image."
    break
  fi
  sleep "$WAIT_SECONDS"
done

if (( SECONDS >= deadline )); then
  echo "Timed out waiting for product datadump job $PRODUCT_DUMP_JOB_ID; leaving the preserved worker untouched." >&2
  exit 1
fi

docker compose stop worker-background
docker exec dataplus-postgres psql -U postgres -d dataplus \
  -v worker_id="$PRESERVED_WORKER_ID" \
  -v source_job_id="$PRODUCT_DUMP_JOB_ID" -c "
  update operations_jobs
  set status = 'stopped',
      ended_at = now(),
      message = 'Daily full supplier reconciliation retired; the Friday reconciliation remains scheduled.',
      raw = raw || jsonb_build_object(
        'status', 'stopped',
        'phase', 'stopped',
        'message', 'Daily full supplier reconciliation retired; the Friday reconciliation remains scheduled.',
        'workerId', '',
        'workerClaimedAt', '',
        'workerLastSeenAt', '',
        'finishedAt', now()
      ),
      updated_at = now()
  where lower(status) in ('queued', 'running')
    and raw ->> 'workerTask' = 'supplier-coverage-refresh'
    and raw -> 'workerPayload' ->> 'trigger' = 'product-dump-import'
    and raw -> 'workerPayload' ->> 'sourceJobId' = :'source_job_id';
"
docker compose up -d --force-recreate worker-background
echo "Background worker handoff completed."
