# Fulfillment performance telemetry

DataPlus measures the Fulfillment console without changing its fulfillment, rate, label, tracking, or shipping-batch behavior.

## Measurements

- Server projection read time covers the PostgreSQL projection lookup or paged projection query.
- Serialization time covers JSON encoding after the projection has been read.
- Total API time covers the complete server handler through serialization.
- Payload size is the uncompressed JSON response size.
- Browser API time covers the request and JSON parsing in the browser.
- Browser render time covers the React state update through two animation frames, which provides a stable approximation of the committed table update.

The console response includes `Server-Timing`, `X-DataPlus-Payload-Bytes`, and `X-DataPlus-Fulfillment-Source` headers for request-level inspection.

## Retention and privacy

Server and browser measurements are kept in memory for one hour, with a maximum of 240 samples in each bucket. They reset whenever the web service restarts or is deployed. Samples contain queue name, source path, durations, payload size, row count, and refresh flags only. They do not retain order IDs, customer names, addresses, SKUs, tracking numbers, rates, or label content.

## Slow thresholds

A sample is highlighted when any of these limits is crossed:

- Total API or browser load: 1,000 ms
- Projection/database read: 750 ms
- Browser render: 250 ms
- JSON payload: 2 MB

Review the live summary under **System Settings > Fulfillment > Fulfillment performance**. The panel loads only when the Fulfillment settings tab is opened. It reports p50, p95, maximums, queue-level measurements, and the current projection refresh state.

## Purchased-label packet integrity

Print packets reconcile purchased batch rows with each order before rendering. If an order import removed an order-level shipment or document reference after purchase while the immutable local PDF still exists, DataPlus restores those references from the batch evidence without buying another label. Packet generation is all-or-nothing: when any purchased label is unavailable or unreadable, DataPlus returns an explicit list of affected orders instead of silently producing a partial PDF.

Temu imports also re-read the latest persisted order immediately before each flush and merge its operational shipments, documents, fulfillment routes, and local history. This prevents an import page loaded before a label purchase from overwriting the newer purchase evidence when that page is saved later.

## Automatic missing-label recovery batches

Every print job stores an immutable manifest of the purchased label document IDs that belonged to the packet when it was created. A label that finishes generating later is never appended silently to that original packet. DataPlus creates a new open `BATCH-####` and matching `PRINT-####` containing only the late labels, while retaining the original shipment, tracking number, carrier charge, and source-batch reference. This is a print-recovery operation only and never calls a carrier or marketplace label-purchase endpoint.

Recovery batches are keyed by the source batch and recovered document IDs. Repeated Temu recovery polling therefore reuses the same recovery batch instead of creating duplicates. The original packet remains printable with exactly its original document manifest, and the recovery batch appears independently in Shipping Batches so the warehouse can close it after the physical labels are handled. Recovery batch rows and print dialogs show a compact bright `Recovered from BATCH-####` provenance label so warehouse staff can trace the packet without opening the source batch.
