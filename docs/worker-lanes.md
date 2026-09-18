# Independent job workers

Deploy `docker-compose.yml` with the same tested release image for worker, worker-orders, and worker-background. All three services are part of the default configuration.

- `worker` / manual: operator-started catalog work, launches, exports and other manual jobs.
- `worker-orders`: order imports, reconciliation, enrichment and return imports, including manual order refreshes.
- `worker-background`: scheduled feeds, inventory and pricing syncs, and maintenance marked scheduled.

Existing queued jobs are routed at claim time; no migration or requeue is required. PostgreSQL's atomic `FOR UPDATE SKIP LOCKED` claim prevents duplicate execution. Each lane has one database session ownership lock and its own heartbeat document. All three can run concurrently. Scheduling runs only on its owning lane. Rate-limit resume times and existing per-operation duplicate guards remain in place. Workers still share database, CPU and marketplace limits; compose resource caps limit contention rather than promising total resource isolation.

Roll out only after the old worker finishes its current job: pause, recheck running claims, replace the worker, then start all three services. Never run an old legacy worker alongside split workers. Health checks must inspect each lane, never infer abandonment from a different lane's heartbeat. New versions also take incompatible shared/exclusive mode locks to prevent accidental mixed operation.

Verify `/api/jobs` worker status includes the three independent workers and check logs for correct task ownership. Test `node scripts/test-worker-lanes.cjs`; SQL routing tests use `WORKER_TEST_DATABASE_URL` pointing at local PostgreSQL and `--sql` (temporary tables only).

