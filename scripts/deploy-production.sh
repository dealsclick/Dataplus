#!/usr/bin/env bash
set -euo pipefail

cd "${DATAPLUS_ROOT:-/root/dataplus}"
mkdir -p generated
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

echo "Starting production services and waiting for health checks..."
docker compose up -d --build --remove-orphans --wait --wait-timeout 180
docker compose ps
curl --fail --silent --show-error http://127.0.0.1:4173/ > /dev/null
record_deployment_status healthy
trap - ERR

echo "DataPlus production deployment is healthy."
