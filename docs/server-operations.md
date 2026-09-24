# DataPlus Server Operations

This runbook covers routine production checks, logs, deployments, worker
restarts, and PostgreSQL diagnostics for the DigitalOcean installation.

## Connect to the server

From PowerShell:

```powershell
ssh -i "$HOME/.ssh/dataplus_do_transfer_ed25519" root@dataplusapp.duckdns.org
```

After connecting:

```bash
cd /root/dataplus
```

## Status and health

Check containers and server resources:

```bash
docker compose ps
docker stats --no-stream
free -h
df -h
```

Check the API. A fast `401` is expected because this request is not
authenticated:

```bash
curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" \
  http://127.0.0.1:4173/api/auth/session
```

Check PostgreSQL:

```bash
docker exec dataplus-postgres pg_isready -U postgres
```

## Logs

Read recent logs:

```bash
docker compose logs --tail=100 dataplus
docker compose logs --tail=100 worker
docker compose logs --tail=100 worker-background
docker compose logs --tail=100 worker-orders
docker compose logs --tail=100 worker-walmart
```

Follow a log in real time:

```bash
docker compose logs --tail=100 -f worker-orders
```

Press `Ctrl+C` to stop following the log. This does not stop the service.

## Worker responsibilities

- `worker`: manual and general marketplace jobs.
- `worker-background`: scheduled maintenance and background jobs.
- `worker-orders`: Shopify, eBay, Walmart, and Temu order operations.
- `worker-walmart`: non-order Walmart feeds, launches, pricing, inventory,
  and reconciliation.
- `dataplus`: the website and API.

Refreshing a browser page does not restart or recreate a server worker.

## Check active jobs before restarting workers

Always run this before restarting or recreating a worker:

```bash
docker exec dataplus-postgres psql -U postgres -d dataplus -P pager=off -c "
SELECT
  job_number,
  name,
  status,
  raw->>'phase' AS phase,
  processed_rows,
  total_rows,
  raw->>'workerLane' AS worker_lane,
  started_at
FROM operations_jobs
WHERE status IN ('queued', 'running', 'stopping')
ORDER BY created_at;
"
```

Recreating a worker while it is processing a job interrupts that run. The job
may then need to be retried.

## Restart services

A restart retains the existing container:

```bash
docker compose restart dataplus
docker compose restart worker
docker compose restart worker-background
docker compose restart worker-orders
docker compose restart worker-walmart
```

Restart the entire application stack only when required:

```bash
docker compose restart
```

## Recreate workers

Recreate a worker to make it use the latest built image:

```bash
docker compose up -d --no-deps --force-recreate worker
docker compose up -d --no-deps --force-recreate worker-background
docker compose up -d --no-deps --force-recreate worker-orders
docker compose up -d --no-deps --force-recreate worker-walmart
```

Recreating one worker does not restart the website, PostgreSQL, Redis, or the
other workers.

## Deploy committed code

Inspect the production checkout before changing it:

```bash
git status
git log -5 --oneline
git branch --show-current
```

Do not discard or overwrite an unexpected dirty working tree. Review the
changes before continuing.

Pull changes only when the production branch can fast-forward:

```bash
git pull --ff-only
```

Build the application and worker images:

```bash
docker compose build dataplus worker
```

Recreate the API:

```bash
docker compose up -d --no-deps --force-recreate dataplus
```

After confirming that no important jobs are active, recreate the workers:

```bash
docker compose up -d --no-deps --force-recreate \
  worker worker-background worker-orders worker-walmart
```

Verify the deployment:

```bash
docker compose ps
docker compose logs --tail=50 dataplus
docker compose logs --tail=50 worker-orders
```

## Inspect jobs

Show recent jobs:

```bash
docker exec dataplus-postgres psql -U postgres -d dataplus -P pager=off -c "
SELECT
  job_number,
  name,
  status,
  processed_rows,
  total_rows,
  message,
  ended_at
FROM operations_jobs
ORDER BY created_at DESC
LIMIT 25;
"
```

Show only active jobs:

```bash
docker exec dataplus-postgres psql -U postgres -d dataplus -P pager=off -c "
SELECT
  job_number,
  name,
  status,
  raw->>'phase' AS phase,
  processed_rows,
  total_rows,
  raw->>'workerLane' AS worker_lane,
  raw->>'workerId' AS worker_id,
  started_at
FROM operations_jobs
WHERE status IN ('queued', 'running', 'stopping')
ORDER BY created_at;
"
```

## Inspect database sessions

Summarize connection states:

```bash
docker exec dataplus-postgres psql -U postgres -d dataplus -P pager=off -c "
SELECT state, count(*)
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state
ORDER BY state;
"
```

Find active, long-running database requests:

```bash
docker exec dataplus-postgres psql -U postgres -d dataplus -P pager=off -c "
SELECT
  pid,
  state,
  now() - query_start AS duration,
  left(query, 160) AS query
FROM pg_stat_activity
WHERE datname = current_database()
  AND state <> 'idle'
ORDER BY query_start;
"
```

An `idle in transaction` session requires investigation. Do not terminate a
database process until its owning job and transaction are understood.

## Safe operating sequence

For a normal deployment or worker update:

1. Check active jobs.
2. Inspect `git status` and the latest commits.
3. Pull or apply the approved commit.
4. Build the required images.
5. Recreate only services that need the update.
6. Check container status and logs.
7. Confirm API and PostgreSQL health.
8. Confirm interrupted or replacement jobs completed correctly.
