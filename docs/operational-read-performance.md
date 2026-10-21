# Operational read performance

Supplier Returns and fulfillment pick-list workflows use targeted PostgreSQL reads without changing their visible React pages, filters, print layouts, or mutation behavior.

## Supplier returns

`GET /api/purchasing/supplier-returns` expands only `purchase_order_records.raw.returns`. PostgreSQL calculates exact queue totals, attention totals, open units, shipped counts, and credit-pending counts across the full collection. Return rows are fetched in bounded pages; the React workspace quietly retrieves all pages before displaying the existing locally filtered table.

## Pick lists

Pick-list printing selects only warehouse fulfillment routes matching the requested status or the saved pick-list route IDs. Pick-list creation resolves only orders containing the selected route IDs before applying the existing route, timeline, and pick-list mutations. A GIN index on `order_records.raw.fulfillmentRoutes` supports these containment lookups.

## Legacy fulfillment feed

The unused `GET /api/fulfillment/work` compatibility route no longer rebuilds 5,000 orders and 5,000 purchase orders. It returns HTTP 410 with `/api/fulfillment/console` as the replacement. The active React Fulfillment workspace already uses the console projection and has no dependency on the retired route.

## Timing

Supplier Returns and pick-list print responses include `Server-Timing: db;dur=<milliseconds>` and `X-DataPlus-Query-Ms`. These headers expose aggregate route query time without retaining order, supplier, customer, SKU, or return content. Compare p50 and p95 from authenticated production requests before changing page sizes or indexes.

## Fulfillment actions

Rate refresh, rate selection, and label-batch creation resolve only orders containing the requested fulfillment route IDs. Linked purchase orders are loaded by the IDs referenced by those orders. This preserves the existing package, eligibility, recovery, and label-purchase rules without loading an arbitrary 5,000-order or 5,000-PO window.

End-of-day manifests read matching carrier and shipment-date rows from `order_shipment_financials`. Shipment-group preview and updates load only the selected orders, their linked purchase orders, and existing members of the same indexed shipment group. These mutations must not fall back to broad operational collection reads.

## Purchase-order mutations

Interactive PO saves read the requested PO first and load vendor or warehouse reference documents only when the submitted fields require them. Re-source and dropship actions use a bounded set of open POs for the affected supplier; consolidation reads only selected POs; linked-order mutations use one targeted `readOrdersByIds` query. External CTech duplicate detection uses the vendor plus normalized external-reference index instead of hydrating the newest 5,000 POs.

The PO edit, inbound tracking, dropship tracking, and ordinary PO action responses expose `Server-Timing` and `X-DataPlus-PO-Save-Ms`. These timings are diagnostic metadata only and do not change the returned purchase-order payload.

Automatic overdue reminders scan nonterminal POs in pages of 250. Purchase pooling keeps the durable requirement ledger intact but loads only due requirements' orders and bounded open-PO pages for the affected suppliers. Interactive routes must not restore `listOrders({ limit: 5000 })` or `listPurchaseOrders({ limit: 5000 })` as a shortcut.

## Atomic purchase-order creation

PostgreSQL reserves PO-number ranges under the `dataplus-purchase-order-number` transaction advisory lock. The allocator reconciles the durable sequence against the highest persisted `PO#<number>` before advancing it. Sequence writes use a monotonic merge, so an older application snapshot cannot lower the reserved number. A number that was reserved by an interrupted or rejected operation is intentionally never reused; small gaps are safer than duplicate accounting identities.

PO creation and conversion workflows persist the affected purchase orders, linked customer orders, purchase requirements, and PO sequence in one database transaction. This applies to manual and external POs, order-based drafts, backorders, re-sourcing, dropship moves and splits, purchasing-pool runs, and automatic order routing. A failed write rolls back the related records together.

User-initiated creation requests carry a stable request ID. `purchase_order_creation_requests` claims that identity inside the same transaction as the PO mutation. Concurrent duplicate submissions wait on the unique request key and replay the first committed response instead of creating another PO. A failed transaction also rolls back its request claim, so a legitimate retry can proceed. Purchase orders retain the creation request, operation, and authenticated actor for audit; the detail page displays the actor and creation path. Starting a new dialog action creates a new request ID, while retrying a timed-out action reuses the existing ID.

Completed retry-ledger rows are retained for 30 days, then removed by the daily Jobs retention cleanup. Pending rows are never removed by retention. The permanent purchase-order record keeps the creation request ID, operation, and actor after the replay payload expires.

`scripts/test-purchase-order-idempotency-postgres.cjs` launches simultaneous mutations with the same request identity against an isolated local PostgreSQL database ending in `_test`. It verifies that exactly one competing PO is stored, the other caller receives the committed response, and a later retry cannot create another PO. Production deployment runs this test against an ephemeral PostgreSQL service before updating the server.

Automatic routing evaluates at most 50 candidate orders per pass and loads a bounded 500-row set of active, appendable purchase orders. Supplier dropship conversion uses the same bounded active-PO context. Do not replace these reads with unfiltered 5,000- or 10,000-record snapshots.

The Purchasing workspace retrieves additional 500-row PO pages in groups of four instead of serially. The global React shell coalesces overlapping refreshes and skips quiet refreshes while the browser tab is hidden. `/api/purchasing/work` and PostgreSQL `/api/state?lite=1` responses expose query timing headers for production p50/p95 diagnosis.
