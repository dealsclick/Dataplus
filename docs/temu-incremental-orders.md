Temu order imports
==================

New orders use polling because the configured Temu subscription does not provide a new-order event. Scheduled imports query the saved update-time checkpoint with a one-hour overlap and walk every page using the existing bounded-window paginator. The configured manual order limit does not truncate scheduled imports. Full detail and shipping/address APIs remain per order; independent enrichment requests run with concurrency two, while order writes remain sequential in page batches.

PostgreSQL imports load only order identities in the current page, preserving saved order fields through the existing merger. They save changed orders in bounded batches rather than rewriting the initial order list. Internal numbering starts above the database's existing order-number maximum. Checkpoint writes change only Temu sync metadata and the order sequence; other channel settings are preserved.

A successful order enrichment stores a canonical list-response fingerprint. An identical response within six hours skips further detail requests and writes. Missing fingerprints, import warnings, changed responses, manual/repair requests, and targeted webhook events always fetch details. The first optimized pass still enriches legacy orders to establish this baseline. Fingerprints are hashes, not copies of address data.

An update checkpoint advances only after every page has completed and there are no enrichment errors. A manually capped, repeated, prematurely empty or failed scan retains its checkpoint. Saved batches remain available for retries. Webhook events queue their own order IDs even if another import is active, acknowledge only after durable queuing, and never trigger a broad scan without identifiers. After-sales, cancellation, and fulfillment events do not replace new-order polling.

Validation: `node scripts/test-temu-order-refresh.cjs`, `node scripts/test-temu-webhook-orders.cjs`, `node scripts/test-temu-order-pagination.js`, plus `scripts/test-temu-order-refresh-postgres.cjs` with `DATAPLUS_TEST_DATABASE_URL` pointing to an isolated local database ending in `_test`.
