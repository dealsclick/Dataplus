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

Automatic routing evaluates at most 50 candidate orders per pass and loads a bounded 500-row set of active, appendable purchase orders. Supplier dropship conversion uses the same bounded active-PO context. Do not replace these reads with unfiltered 5,000- or 10,000-record snapshots.
