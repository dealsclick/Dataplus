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
