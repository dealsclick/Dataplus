# Production memory safety

DataPlus runs several Node processes plus PostgreSQL on one 16 GB host. Memory safety therefore depends on bounded work and host-wide capacity planning, not only on optimizing one endpoint.

## Runtime budgets

`docker-compose.yml` gives PostgreSQL, Redis, Cloudflare, the web API, and every worker an explicit memory ceiling. V8 heap limits are lower than the container limits so native PDF buffers, network buffers, and Node overhead retain headroom. The configured application ceilings total about 12.75 GB, leaving capacity for Docker, the kernel, filesystem cache, and the small documentation services on the 16 GB host.

Redis is a cache, so it has a 384 MB internal LRU budget inside a 512 MB container ceiling. Eviction is preferable to allowing cache growth to compete with PostgreSQL or fulfillment.

PostgreSQL has a 4 GB container ceiling with 768 MB shared buffers, 4 MB work memory, and 128 MB maintenance memory. PostgreSQL memory accounting also includes connection processes, parallel workers, shared memory, and charged filesystem cache; the earlier 3 GB ceiling was too narrow under production concurrency. `effective_cache_size` is a planner estimate and does not reserve RAM.

Do not raise one worker limit without recalculating the sum of every concurrently running service. A larger individual heap can make the entire host less reliable.

## Print packets

Purchased-label packets are assembled one at a time. Requests for the same packet revision share one in-progress build instead of creating duplicate PDF documents in memory.

Generated packets use a byte-budgeted LRU cache:

- Total cache budget: 32 MB by default.
- Maximum cached packet: 16 MB by default.
- Maximum entries: 8.
- Expiration: 5 minutes.
- Larger packets are returned normally but are not retained in memory.

The byte limits can be lowered with `DATAPLUS_PRINT_PACKET_CACHE_MB` and `DATAPLUS_PRINT_PACKET_CACHE_ENTRY_MB`. Raising them requires a host-memory review.

## Scheduled routing

The web scheduler performs only a compact summary scan and queues up to 25 candidate order IDs. Order hydration, inventory-ledger access, purchase-order reads, routing, and persistence run in the background worker. This keeps recurring operational work out of the process serving browser requests.

The purchase-pooling scheduler waits while paid-order routing is queued or running so the two workflows do not mutate the same demand concurrently.

## Monitoring and incident checks

System Settings > Performance reports current web-process RSS, heap, external buffers, print-cache bytes, cached packets, active builds, and print-build queue depth. Request timing remains bounded and memory-only.

On the host, confirm container use with:

```bash
docker stats --no-stream
free -h
journalctl -k --since "1 hour ago" | grep -i -E "oom|out of memory|killed process"
```

An OOM kill is a host-capacity incident even when the final request was small. Check overlapping workers and recurring schedulers before attributing it to the visible action.

## Deployment verification

Run these checks before deployment:

```powershell
node scripts/test-memory-safety.cjs
node scripts/test-server-scheduler-efficiency.cjs
node --test scripts/test-fulfillment-deployment-safety.cjs
npm run web:build
git diff --check
```

After deployment, verify that all containers remain below their ceilings, background routing is claimed by `dataplus-worker-background`, printing succeeds, and no new kernel OOM events appear.
