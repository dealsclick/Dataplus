# Order Data Review

Open Orders > Data Review at `/orders/data-review`. Start the review from Actions. This is a read-only, on-demand review of saved order and return data across channels. Shared channel references are valid and are never a finding.

Operational findings: full shipment outside the completed queue (unless an open return, unship correction, cancellation, or blocking exception explains it), inconsistent line fulfillment, and outstanding active PO links on shipped orders. PO recommendations always require buyer review; they never imply canceling an entire pooled PO.

Reporting gaps: missing saved tracking/carrier/label costs, and returns with no resolvable internal order link. An explicit zero label cost is valid. Customer shipping revenue is not used as the label cost. These findings do not change operational queues or create exceptions.

`GET /api/orders/data-review?stage=orders|returns&after=<internal-id>` reads at most 100 records per request with keyset pagination, in a read-only transaction with a five-second SQL statement timeout. It reads related returns and POs for the current batch, not marketplace APIs or inventory feeds. It does not enqueue work, modify imports, or restart services. Existing Orders view permission is required; CSV controls follow Orders export permission.

The browser requests one batch at a time, with a one-second delay. Pause/resume retains the cursor and accumulated findings in the current page. Errors pause on the failed batch. Leaving/reloading the page discards the local report; download the filtered CSV to retain it. Export identifies partial versus completed scans. Results are not a transactionally frozen snapshot across batches: imports may add or change records during review, so rerun after import completion. Findings are paginated in the UI and are not capped to the Orders page's display limit.

No corrections, deletions, new POs, or source notifications are performed. SKU costs are not fetched from catalog data during this scan. A canceled order is intentionally not treated as safe to move to Done merely because it has a shipped status elsewhere.
