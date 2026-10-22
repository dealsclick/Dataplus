# Shipping cost reconciliation

The operational and accounting rollup is available in **Reporting > Shipping Report** at `/reports/shipping`. See [shipping-report.md](shipping-report.md) for metrics, filters, allocation rules, and export fields.

Shipping revenue and shipping expense are separate facts. Customer-paid shipping is normalized in `order_shipping_revenue`; it is sales revenue and is never used as carrier expense. Shipping expense is normalized in `order_shipment_financials`, one row per order and physical shipment. These ledgers are intentionally independent of the `order_records` foreign-key lifecycle because marketplace refreshes currently rewrite normalized order rows. A routine order refresh must never erase revenue or carrier-billing evidence.

The record keeps distinct financial facts:

- `quoted_cost`: the rate shown before label purchase, when available.
- `estimated_shipping_cost`: the amount charged when the label was purchased. It remains an estimate until settlement.
- `refunded_cost`: label refunds or credits known before carrier reconciliation.
- `actual_shipping_cost`: the reconciled carrier or channel settlement amount. Once present, this is authoritative for order P&L.
- `billing_status`, invoice identifiers, billed/reconciled timestamps, and reconciler identify the reconciliation state without replacing purchase evidence.

It also retains tracking number, provider and label source, carrier/service, currency, channel, destination city/state/postal code/country, batch and print identifiers, shared-shipment/master identities, warehouse, package measurements, purchase and ship timestamps, void state, and the compact shipment evidence. Shared labels use the per-order cost allocations already created by the shipment-group workflow so one physical label is not charged in full against every order. Product category and merchandise margin remain normalized on product/order-line tables and are joined for reporting rather than copied into every shipment.

`shipping_settlements` stores future carrier invoices or channel settlement headers. `shipping_settlement_lines` stores signed transportation charges, surcharges, corrections, and credits, including unmatched lines for review. The importer and marketplace settlement API integration are intentionally deferred; the storage contract is in place now.

Order saves automatically upsert revenue and estimated shipment facts while preserving actual cost and reconciliation fields. Voided shipments do not contribute to P&L. Sales reporting uses final `actual_shipping_cost` when present; otherwise it uses estimated shipping cost less a recorded label refund. Customer-paid shipping remains revenue and is never subtracted as an expense. Existing order-level shipping adjustments remain additive until settlement import is implemented.

Backfill existing shipment history after deploying the schema:

```powershell
node scripts/backfill-order-shipment-financials.cjs
node scripts/backfill-order-shipment-financials.cjs --apply
```

The first command is a dry run. Take a database backup before applying the backfill. The script does not change orders, labels, tracking, or print history.

The Shipping report groups these rows by carrier, service, destination state, channel, supplier, category, SKU, provider, label source, billing status, and cost basis. Carrier or channel settlement import should match tracking number first, retain unmatched lines for review, sum all signed fees into `actual_shipping_cost`, and mark the shipment reconciled only after review.

## Deferred settlement import

- Import carrier invoices and marketplace/channel settlements from CSV, XLSX, or API.
- Preserve every source line, including additional handling, address correction, fuel, residential, dimensional-weight, and credit adjustments.
- Match by tracking number first and send ambiguous or unmatched lines to review.
- Recalculate the actual shipment expense without changing the amount the customer paid for shipping.
