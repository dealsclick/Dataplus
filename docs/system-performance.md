# System performance telemetry

System Settings > Performance shows bounded request measurements for the main DataPlus workspaces plus read-only summaries of operation-job duration. The monitor is diagnostic only and does not add database writes to normal requests.

## Server measurements

Every authenticated API response records its workspace, HTTP method, status code, elapsed time, response size, aggregate PostgreSQL time, query count, returned row count, positive RSS growth, and timestamp. Paths are reduced to a fixed workspace name before storage. Request bodies, query strings, entity IDs, order numbers, customer data, SKUs, tracking numbers, SQL text, and response content are never retained.

The server keeps at most 600 samples for one hour. The diagnostics and browser-sample endpoints are excluded so opening the panel does not measure itself. A request is slow when it takes at least 1,000 ms, returns a 5xx status, or produces more than 2 MB of JSON.

## Browser measurements

The shared React API client measures fetch and JSON parsing time without delaying the caller. It queues only workspace, method, status, success, and elapsed time. The browser sends at most one small batch every 30 seconds, or after 20 samples, directly to the in-memory collector. The queue is capped at 100 samples and failed telemetry delivery never affects the original application request.

The server retains at most 300 browser samples for one hour. Browser reporting excludes the performance endpoints and the existing Fulfillment diagnostics client endpoint.

## Dashboard

The panel loads only when Performance is opened. It reports server, browser, PostgreSQL, payload, and memory p50/p95 measurements, errors, per-workspace comparisons, recent slow activity, and one-hour duration summaries by worker workload lane. Request samples reset on deployment or service restart. Job summaries are calculated from the durable operations ledger only when the panel is opened.

Use the workspace p95 and recent slow table to choose the next optimization. The panel must remain observational: do not add synchronous database persistence, request-body capture, raw route storage, or per-request telemetry network calls.

The dashboard also reports the current web process RSS, V8 heap, external buffers, print-packet cache size, cached packet count, and print-build queue depth. These are point-in-time process measurements and reset when the service restarts. They do not contain order or customer data.

## Workload concurrency

Operation jobs retain their existing physical worker ownership, while the database claim lock also applies a business workload cap across workers. Carrier-rate refresh, label purchase, catalog import, and fulfillment projection rebuild each permit one active job. Marketplace synchronization permits two active jobs across Shopify, eBay, Temu, and Walmart. A queued job remains queued when its workload is full; no request thread waits for a slot and no job is discarded.

The workload lane and cap are written into the claimed job record. This makes the current lane visible in performance diagnostics and preserves an audit trail for later capacity tuning.

Production memory ceilings and the operational response to memory pressure are documented in `docs/memory-safety.md`.
