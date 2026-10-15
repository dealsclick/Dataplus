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
