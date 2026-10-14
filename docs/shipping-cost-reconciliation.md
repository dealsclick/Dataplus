# Shipping cost reconciliation

Shipping expense is normalized in `order_shipment_financials`, one row per order and physical shipment. The table is intentionally independent of the `order_records` foreign-key lifecycle because marketplace refreshes currently rewrite normalized order rows. A routine order refresh must never erase carrier-billing evidence.

The record keeps distinct financial facts:

- `quoted_cost`: the rate shown before label purchase, when available.
- `purchased_cost`: the amount charged when the label was purchased.
- `refunded_cost`: label refunds or credits known before carrier reconciliation.
- `billed_cost`: the carrier invoice amount. Once present, this is authoritative for order P&L.
- `billing_status`, invoice identifiers, billed/reconciled timestamps, and reconciler identify the reconciliation state without replacing purchase evidence.

It also retains tracking number, provider and label source, carrier/service, currency, channel, destination city/state/postal code/country, batch and print identifiers, shared-shipment/master identities, warehouse, package measurements, purchase and ship timestamps, void state, and the compact shipment evidence. Shared labels use the per-order cost allocations already created by the shipment-group workflow so one physical label is not charged in full against every order. Product category and merchandise margin remain normalized on product/order-line tables and are joined for reporting rather than copied into every shipment.

Order saves automatically upsert shipment facts while preserving carrier invoice and reconciliation fields. Voided shipments do not contribute to P&L. Sales reporting uses final `billed_cost` when present; otherwise it uses purchased cost less a recorded label refund. Existing order-level shipping adjustments remain additive until carrier invoice import is implemented.

Backfill existing shipment history after deploying the schema:

```powershell
node scripts/backfill-order-shipment-financials.cjs
node scripts/backfill-order-shipment-financials.cjs --apply
```

The first command is a dry run. Take a database backup before applying the backfill. The script does not change orders, labels, tracking, or print history.

The next reporting layer can group these rows by carrier, service, destination state, channel, and joined product category. Carrier invoice import should match tracking number first, retain unmatched invoice lines for review, and write billed values only after explicit reconciliation.
