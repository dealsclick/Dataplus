#!/usr/bin/env bash
set -euo pipefail

cd "${DATAPLUS_ROOT:-/root/dataplus}"
mkdir -p generated

echo "Building DataPlus application images..."
docker compose build

echo "Generating release history from the checked-out repository..."
docker compose run --rm --no-deps \
  -v "$PWD/.git:/app/.git:ro" \
  -v "$PWD/generated:/app/generated" \
  dataplus node scripts/generate-release-history.js

echo "Starting production services and waiting for health checks..."
docker compose up -d --build --remove-orphans --wait --wait-timeout 180
docker compose ps
curl --fail --silent --show-error http://127.0.0.1:4173/ > /dev/null

echo "DataPlus production deployment is healthy."
