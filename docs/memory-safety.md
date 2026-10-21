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

## Fulfillment compatibility data

Historical label batches remain in compatibility documents while the fulfillment schema is migrated. In production, 150 batch records occupied about 133 MB as uncompressed JSON. Loading that collection into Node expanded it several times over, and sending the full collection through one PostgreSQL `jsonb_to_recordset` parameter caused both the API and a database backend to exceed their memory ceilings. This made a one-label action appear to be the cause even though a broad scheduled recovery pass was the actual trigger.

The containment rules are:

- Label-purchase and incomplete-packet recovery query only batches whose row status can require work.
- Tracking refresh starts from the relational shipment index and loads at most 50 due orders plus five legacy recovery batches per run. Indexed shipments do not load their full historical batches; after finding a new number, the worker locks and patches only that one batch document.
- Scheduled tracking refreshes are queued to the bounded background worker; the web process does not execute them after startup or on the recurring timer.
- Automatic tracking uses provider APIs only. PDF text extraction is reserved for explicit recovery, skips files larger than 8 MB, and cannot accumulate across the scheduled batch.
- Scheduled tracking processes at most 10 indexed shipments per run, does not hydrate legacy batch history, caps each Temu tracking response at 2 MB, and pauses before the worker reaches 700 MB RSS.
- Fulfillment snapshot rebuilds ask PostgreSQL for compact batch projections. Embedded carrier payloads and document metadata in historical batches never enter the web heap.
- Automatic rate discovery reads at most 200 compact ready rows directly from the relational projection instead of hydrating the full fulfillment console.
- Rate workers hydrate only their targeted orders and fulfillment settings. Scheduled provider lanes run sequentially and stop before the worker memory ceiling.
- Compatibility collection writes are serialized across processes with a PostgreSQL advisory transaction lock.
- Entity rows are sent to PostgreSQL in byte-bounded payloads, 2 MB by default, instead of one collection-sized JSON parameter. A single larger entity is written alone.
- Existing per-entity timestamps prevent an older worker snapshot from replacing a newer fulfillment batch.

`DATAPLUS_STATE_WRITE_BATCH_BYTES` can lower the compatibility write budget. Raising it requires load testing against both the Node heap and the PostgreSQL cgroup.

Startup never loads thousands of purchase orders to normalize the supplier directory. Canonical supplier merging remains attached to vendor and import workflows where the changed records are already in scope. Historical global reconciliation is an explicit maintenance operation, not web-process startup work.

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
