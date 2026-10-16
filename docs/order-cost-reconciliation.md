# Order Cost Reconciliation

Marketplace order feeds may omit product cost or send numeric zero as an unknown placeholder. DataPlus distinguishes that placeholder from a deliberately recorded zero cost by requiring provenance such as `costSource`, `costUpdatedAt`, or a purchase-order reference before zero is treated as authoritative.

For an unknown line cost, the system resolves the imported SKU, approved alias, or selling-unit variant against the catalog and records an estimated unit cost on the order line. Direct `EA` sales use the catalog each-unit cost even when the supplier record also describes a larger available pack. Selling-unit variants retain their own variant cost. Positive historical order costs and zero costs with explicit provenance are never replaced.

New eBay and Temu imports hydrate missing costs before persistence. Historical unresolved records can be reviewed with:

```powershell
node scripts/backfill-order-costs.cjs
```

Apply the reviewed backfill with `--apply`. Backfilled lines retain `costSource: catalog_estimate`, the matched catalog SKU, and an estimate timestamp so future landed-cost or settlement reconciliation can supersede the estimate without losing provenance.

Canceled marketplace orders remain stored for audit and reporting history, but are excluded from active Fulfillment. Temu status reconciliation is enabled by default and rotates through open orders hourly. A newly detected cancellation stores channel status and cancellation time, closes active demand, and routes any already-shipped parcel to Do Not Ship & Recovery instead of leaving it in Pending shipment.
