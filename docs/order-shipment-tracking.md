# Order shipment tracking storage

Shipment tracking work is indexed in `order_shipment_tracking`. The scheduled carrier refresh queries this table for due work and loads complete order JSON only for matching order IDs.

Tracking work has two lifecycles:

- Tracking recovery: a purchased label or marketplace package is missing a tracking number. Provider JSON is checked first. Stored label text is a final fallback.
- Carrier monitoring: a shipment has tracking and remains monitored until delivery or another terminal shipment state.

Canceled, voided, delivered, completed, and closed orders are excluded. Shipped and fulfilled orders remain eligible for carrier monitoring until delivery.

Large provider responses are not retained in hot `order_records.raw` documents. `compactOrderForStorage` keeps operational identifiers and saves removed provider evidence as gzip-compressed rows in `order_payload_archives`. Printable labels remain normal order attachments. Shipping-rate activity keeps the latest 20 compact events; removed detail remains in the compressed archive.

Run the backfill after deploying the schema:

```powershell
node scripts/backfill-order-shipment-tracking.cjs
node scripts/backfill-order-shipment-tracking.cjs --apply
```

The first command is a dry run. Take a database backup before applying the migration. The migration does not change order timestamps or remove attachment files.
