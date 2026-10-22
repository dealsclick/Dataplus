# Production memory safety

DataPlus runs several Node processes plus PostgreSQL on one 16 GB host. Memory safety therefore depends on bounded work and host-wide capacity planning, not only on optimizing one endpoint.

## Runtime budgets

`docker-compose.yml` gives PostgreSQL, Redis, Cloudflare, the web API, and every worker an explicit memory ceiling. V8 heap limits are lower than the container limits so native PDF buffers, network buffers, and Node overhead retain headroom. The configured application ceilings total about 12.75 GB, leaving capacity for Docker, the kernel, filesystem cache, and the small documentation services on the 16 GB host.

Redis is a cache, so it has a 384 MB internal LRU budget inside a 512 MB container ceiling. Eviction is preferable to allowing cache growth to compete with PostgreSQL or fulfillment.

PostgreSQL has a 4 GB container ceiling with 768 MB shared buffers, 4 MB work memory, and 128 MB maintenance memory. PostgreSQL memory accounting also includes connection processes, parallel workers, shared memory, and charged filesystem cache; the earlier 3 GB ceiling was too narrow under production concurrency. `effective_cache_size` is a planner estimate and does not reserve RAM.

Do not raise one worker limit without recalculating the sum of every concurrently running service. A larger individual heap can make the entire host less reliable.

## Worker process isolation

Every worker lane is owned by a small supervisor process. The application worker runs as a disposable child, remains available while idle, claims at most one job, and exits after that job reaches a terminal state. The next job therefore starts with a clean V8 heap and clean module-level caches.

The supervisor measures RSS for the complete child process tree every 200 milliseconds. This includes provider parsers, import helpers, PDF utilities, and other descendants, not only the main Node heap. Standard jobs use lane-specific budgets below their Docker cgroup ceilings; known heavy jobs receive a separate, still-bounded budget. Defaults are:

- 480 MB for Shopify and eBay order jobs.
- 1,000 MB for Temu order jobs.
- 680 MB for normal background and Walmart jobs.
- 1,100 MB for manual jobs.

- 560 MB for heavy Shopify order jobs, 600 MB for heavy eBay order jobs, 1,200 MB for heavy Temu order jobs, 820 MB for heavy background and Walmart jobs, and 1,280 MB for heavy manual jobs.

eBay order imports use a minimal PostgreSQL bootstrap: connection settings, connector state, sequence data, system settings, and warehouses. They do not hydrate the general 5,000-order/5,000-PO snapshot or 1,000 historical jobs before the first eBay API page. Existing-order matches and writes remain scoped PostgreSQL reads. The worker requests at most 25 orders per eBay page and evicts each saved page from its temporary order array after PostgreSQL commits it. Terminal-order reconciliation loads its purchasing and fulfillment state only when the imported page actually contains terminal orders, without rehydrating the general order/job snapshot. The eBay importer is assigned to the bounded 600 MB heavy budget because its measured clean API/database working set is about 562 MB; the guard remains 168 MB below the lane's 768 MB container ceiling.

Configure the standard and heavy ceilings with `DATAPLUS_WORKER_JOB_RSS_MB` and `DATAPLUS_WORKER_HEAVY_JOB_RSS_MB`. Both must remain below the lane's Docker memory limit with enough room for the supervisor and native runtime overhead.

When a child exceeds its budget, the supervisor terminates the entire process group before the kernel must kill the container. The claimed operation is moved to terminal `warning` state with the observed RSS, budget, lane, task, and recovery guidance. It is deliberately not retried automatically because label purchases, marketplace imports, and other jobs may have completed an external side effect before interruption. The supervisor then starts a clean child, so the lane remains online and unrelated work continues.

An unexpected child exit receives the same durable treatment. Normal deployments forward `SIGTERM` to the active child and preserve the existing deployment recovery behavior instead of misclassifying a planned restart as a memory incident.

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

## Fulfillment storage

Shipping batches and print-queue jobs use dedicated PostgreSQL tables. Batch headers live in `fulfillment_label_batches`, purchased-label rows live in `fulfillment_label_batch_rows`, and warehouse/print/PDF history lives in `fulfillment_batch_events`. Print-job headers, document references, and print/PDF events live in `fulfillment_print_jobs`, `fulfillment_print_job_documents`, and `fulfillment_print_events`.

Startup performs an idempotent migration from the old `entity_documents` rows. Each record is normalized in its own transaction and the compatibility row is deleted only after the relational write commits. An interrupted migration resumes safely, and per-record timestamps prevent a stale worker snapshot from replacing newer operational data. Compatibility adapters preserve the existing JavaScript object shapes while request paths query only the relational rows they need.

Label PDF bytes remain filesystem artifacts. PostgreSQL stores batch ownership, document identifiers, status, tracking, cost, and audit metadata; PDF bytes are streamed from disk and are not expanded into database JSON or loaded with normal batch reads.

Before normalization, 150 historical batch records occupied about 133 MB as uncompressed JSON. Loading that collection into Node expanded it several times over, and sending the full collection through one PostgreSQL `jsonb_to_recordset` parameter caused both the API and a database backend to exceed their memory ceilings. This made a one-label action appear to be the cause even though a broad scheduled recovery pass was the actual trigger.

The fulfillment rules are:

- Label-purchase and incomplete-packet recovery query only batches whose row status can require work.
- Tracking refresh starts from the relational shipment index and loads at most 50 due orders plus five legacy recovery batches per run. Indexed shipments do not load their full historical batches; after finding a new number, the worker locks and patches only that one batch document.
- Scheduled tracking refreshes are queued to the bounded background worker; the web process does not execute them after startup or on the recurring timer.
- Automatic tracking uses provider APIs only. PDF text extraction is reserved for explicit recovery, skips files larger than 8 MB, and cannot accumulate across the scheduled batch.
- Scheduled tracking processes at most 10 indexed shipments per run, does not hydrate legacy batch history, caps each Temu tracking response at 2 MB, and pauses before the worker reaches 700 MB RSS.
- Temu shipment and rate responses are traversed once with hard node and result-count limits. Service fields are extracted together in one bounded walk instead of rescanning every nested response once per field, and package traversal is cycle-safe. Shipping-service responses are capped at 1 MB and 100 services; warehouse and carrier-directory responses are capped at 512 KB.
- Fulfillment snapshot rebuilds ask PostgreSQL for compact batch projections. Embedded carrier payloads and document metadata in historical batches never enter the web heap.
- Automatic rate discovery reads at most 200 compact ready rows directly from the relational projection instead of hydrating the full fulfillment console.
- Rate workers hydrate only their targeted orders and fulfillment settings. Scheduled provider lanes run sequentially and stop before the worker memory ceiling.
- Veeqo rate shopping never starts allocation-order fallback speculatively. The fallback runs only when the primary quote reports FedEx unavailable, searches identities sequentially with ten results per request, and caps order-search and allocation-rate responses at 1 MB. Primary quote responses are capped at 2 MB and 100 rates; general Veeqo JSON responses retain an 8 MB backstop and label documents retain a 32 MB limit.
- Temu shipping-service and Veeqo rate-shopping calls run through a disposable Node JSON-parser subprocess with a 96 MB V8 heap. That child uses bounded streaming `curl`, requests `Accept-Encoding: identity`, rejects compressed responses, and enforces provider byte limits and deadlines. The parent independently caps child output and never parses raw provider bytes. Other provider calls retain the shared raw Node transport with the same identity-encoding, declared-size, streamed-size, and timeout checks. A native HTTP or parser failure therefore terminates only the disposable process: the affected quote fails while the worker, scheduler, printing, and other users remain online.
- Provider-stage memory checkpoints record RSS, heap, and external-buffer use around Temu and Veeqo rate work. A worker at the soft RSS ceiling stops the affected quote with an actionable error instead of accepting another provider stage.
- Queue creation uses a minimal in-memory job context. It never loads application state merely to insert a fulfillment rate or label-purchase job.
- Label purchasing reads and persists only the requested batch and its related print jobs. A one-label purchase cannot hydrate or serialize the complete label-batch history.
- Shipping-batch creation uses compact PostgreSQL batch projections for active-assignment checks and loads a full batch only when an operator explicitly reuses that batch number.
- Batch and print-job mutations lock and update one normalized record at a time. They never rewrite the complete fulfillment history.
- Batch listing, recovery, tracking, sequence generation, and print-agent polling use indexed relational queries.
- Remaining compatibility collections still use byte-bounded writes and cross-process advisory locks, but fulfillment batches and print jobs no longer use that storage path.

`DATAPLUS_STATE_WRITE_BATCH_BYTES` can lower the compatibility write budget. Raising it requires load testing against both the Node heap and the PostgreSQL cgroup.

Startup never loads thousands of purchase orders to normalize the supplier directory. Canonical supplier merging remains attached to vendor and import workflows where the changed records are already in scope. Historical global reconciliation is an explicit maintenance operation, not web-process startup work.

Paid-order routing and PO cutoff pooling read a named, minimal state projection containing only sequence, system settings, channels, vendors, warehouses, and the small mutable ledgers they require. Historical warehouse audits, label batches, print queues, and fulfillment snapshots are excluded. The background lane also recycles its process after a completed job when RSS is at least 384 MB by default, allowing Docker to restart it with a clean heap before another task is claimed. `DATAPLUS_WORKER_RECYCLE_RSS_MB` may lower or raise that post-job threshold; raising it requires a container-memory review.

Post-job recycling remains a secondary guard inside the disposable child. The supervisor boundary is the primary protection: memory is not carried from one job into the next even when the child finishes below that older recycle threshold.

## Channel activity logs

PostgreSQL is the durable channel activity ledger in production. Workers do not duplicate every API event into the shared `channel-api-log.ndjson` compatibility file. That file had grown past 1 GB and caused each fresh worker's retention pass to read the entire file into memory, so an otherwise small label, rate, or tracking action could appear to exhaust the worker.

The NDJSON file remains a fallback when PostgreSQL is unavailable. Its cleanup streams at most the newest 64 MB, applies retention line by line, detects concurrent writes before replacing the file, and never builds the complete log in memory. Temu tracking lookups also use the bounded provider subprocess so an unusual provider response cannot inflate the main worker heap.

Before a disposable child closes its database pool, it drains channel activity inserts and any fulfillment projection patch queued by the completed job. This preserves the durable audit trail and the same immediate fulfillment visibility as a long-lived worker without leaving callbacks attached to a closed connection pool.

## Operational state normalization

Production uses PostgreSQL as the source of truth for mutable operational state that previously required whole-file parsing or whole-document rewrites:

- Shopify product status rows are read and upserted from `shopify_product_statuses`. The 155 MB compatibility JSON file is neither parsed nor rewritten in PostgreSQL mode. Request paths query only the SKUs they need; paged exports use status already projected onto product rows.
- Warehouse audits use normalized audit and line tables. Embedded data-URL images live in `warehouse_audit_media` and are fetched one image at a time through the authenticated audit image endpoint. Normal audit reads never expand every photograph into the Node heap.
- Application users, permission templates, permission audit events, and hashed authentication sessions use dedicated tables. Raw session tokens are never stored in PostgreSQL. The legacy session file is imported once, removed, and replaced by non-secret migration metadata.
- The relational fulfillment console projection is the only persisted production snapshot. A projection publish failure keeps the current in-memory view and reports the error; it does not recreate the retired multi-megabyte `fulfillmentConsoleSnapshot` document.
- Shipping-label batches and print jobs use normalized header, row, document-reference, and event tables. The compatibility read/write adapters hydrate the existing API shape without restoring collection-wide JSON documents.
- System settings and connector state are written to PostgreSQL in production. Local JSON remains a development fallback only. Runtime credentials continue to use their protected credential paths and are not copied into general-purpose operational tables.

Compatibility adapters preserve the existing API object shapes while these records are normalized. New code should use the dedicated database functions and must not restore full JSON reads on production request paths.

## Artifact lifecycle

Large imports, exports, backups, marketplace response files, label documents, and attachments remain filesystem artifacts rather than PostgreSQL blobs. Their metadata and job ownership are relational; their bytes are streamed from disk. The web scheduler checks every six hours and queues at most one jobs-retention cleanup per 24 hours. Files past the configured seven-day retention are removed by a bounded background worker, including orphaned job directories.

In PostgreSQL mode, retention pages through compact job IDs, microsecond-precision completion cursors, and artifact paths only. It never hydrates the full operations history or the JSON `raw` payloads. Directory removal counts entries with an iterator and yields between batches, so a multi-gigabyte artifact backlog cannot become a multi-gigabyte worker heap. Clearing an expired artifact also removes its relational path metadata in the same PostgreSQL transaction; job history remains available for audit.

Worker post-job projection and channel-activity drains are capped at 15 seconds each. A delayed deferred write is logged and allowed to finish independently instead of blocking the entire worker lane.

The supervisor also enforces a 20-second hard post-job exit budget. This outer guard remains effective when synchronous projection work blocks the child process event loop; the completed job stays committed and the disposable child is recycled so the next queued job can run.

Completion IPC acknowledgement is capped at one second, and fulfillment label purchases outrank refresh and maintenance work in their worker lane. A delayed supervisor callback or an older automatic refresh therefore cannot hold printing or a guarded deployment indefinitely. The supervisor's hard exit timer applies even after the child sends its final completed signal; that signal protects the durable job result but never exempts a disposable process that failed to exit.

Product dumps and backups have separate business retention and must not be loaded into memory merely to inspect them. BSON/GZIP imports stay streaming. Moving artifact bytes to object storage is a deployment option, not a reason to put multi-gigabyte files into PostgreSQL.

Recurring feed and supplier-reminder schedulers also read explicit named fields. They must never call `readStateDocuments()`: that API is an administrative compatibility read and includes every operational collection. Data-quality scans use only channel and category configuration before paging products from PostgreSQL.

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
node scripts/test-operational-state-normalization.cjs
node scripts/test-bounded-http.cjs
node scripts/test-bounded-ndjson.cjs
node scripts/test-worker-supervisor.cjs
node scripts/test-server-scheduler-efficiency.cjs
node scripts/test-temu-package-parser.cjs
node --test scripts/test-fulfillment-deployment-safety.cjs
node scripts/test-fulfillment-state-documents.js
node scripts/test-print-agent-polling-efficiency.cjs
# Set FULFILLMENT_STORAGE_TEST_DATABASE_URL to an isolated database ending in _fulfillment_test.
node scripts/test-fulfillment-storage-postgres.cjs
npm run web:build
git diff --check
```

After deployment, verify that all containers remain below their ceilings, background routing is claimed by `dataplus-worker-background`, printing succeeds, and no new kernel OOM events appear.
