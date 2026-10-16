# Shipping cost reconciliation

Shipping revenue and shipping expense are separate facts. Customer-paid shipping is normalized in `order_shipping_revenue`; it is sales revenue and is never used as carrier expense. Shipping expense is normalized in `order_shipment_financials`, one row per order and physical shipment. These ledgers are intentionally independent of the `order_records` foreign-key lifecycle because marketplace refreshes currently rewrite normalized order rows. A routine order refresh must never erase revenue or carrier-billing evidence.

The record keeps distinct financial facts:

- `quoted_cost`: the rate shown before label purchase, when available.
- `estimated_shipping_cost`: the amount charged when the label was purchased. It remains an estimate until settlement.
- `refunded_cost`: label refunds or credits known before carrier reconciliation.
- `actual_shipping_cost`: the reconciled carrier or channel settlement amount. Once present, this is authoritative for order P&L.
- `billing_status`, invoice identifiers, billed/reconciled timestamps, and reconciler identify the reconciliation state without replacing purchase evidence.

It also retains tracking number, provider and label source, carrier/service, currency, channel, destination city/state/postal code/country, batch and print identifiers, shared-shipment/master identities, warehouse, package measurements, purchase and ship timestamps, void state, and the compact shipment evidence. Shared labels use the per-order cost allocations already created by the shipment-group workflow so one physical label is not charged in full against every order. Product category and merchandise margin remain normalized on product/order-line tables and are joined for reporting rather than copied into every shipment.

`shipping_settlements` stores carrier invoices or channel settlement headers. `shipping_settlement_lines` stores signed transportation charges, surcharges, corrections, and credits, including unmatched lines for review. Source hashes prevent an exact file from being imported twice, and deterministic external line IDs prevent overlapping Temu date-range reports from posting the same transaction twice.

Order saves automatically upsert revenue and estimated shipment facts while preserving actual cost and reconciliation fields. Voided shipments do not contribute to P&L. Sales reporting uses final `actual_shipping_cost` when present; otherwise it uses estimated shipping cost less a recorded label refund. Customer-paid shipping remains revenue and is never subtracted as an expense. Existing order-level shipping adjustments remain additive until settlement import is implemented.

Backfill existing shipment history after deploying the schema:

```powershell
node scripts/backfill-order-shipment-financials.cjs
node scripts/backfill-order-shipment-financials.cjs --apply
```

The first command is a dry run. Take a database backup before applying the backfill. The script does not change orders, labels, tracking, or print history.

The reporting layer can group these rows by carrier, service, destination state, channel, and joined product category. Carrier or channel settlement import matches tracking number first, retains unmatched lines for review, sums all signed fees into `actual_shipping_cost`, and marks the shipment reconciled only after an authoritative adjustment is available.

## Temu settlement import

- Accounting > Channel fees accepts Temu's detailed Reports workbook in XLS, XLSX, or CSV format. The smaller Transactions export is not sufficient for matching because it replaces the operational `PO-...` order number with a `DO...` financial reference.
- `Shipping label purchase` is retained as the initial estimated charge. `Shipping label purchase adjustment` is authoritative final-billing evidence. DataPlus adds the signed purchase and adjustment ledger values to calculate final shipping expense.
- Temu exports negative values for charges and positive values for credits. DataPlus normalizes those signs so shipping expense is positive and credits reduce it.
- Return-label purchases, adjustments, and platform-covered credits are retained separately and never alter the outbound shipment cost.
- Matching is exact and channel-bound: Temu order number first, then tracking/reference against that order's normalized shipments. Ambiguous and unmatched lines remain visible for review.
- Reconciliation updates only `actual_shipping_cost`; it never changes customer-paid shipping revenue or marketplace fees.
