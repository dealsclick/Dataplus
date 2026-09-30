# Fulfillment operations

DataPlus Fulfillment is the warehouse workspace for picking, packing, carrier-rate selection, bulk label purchase, printing, shipment review, exceptions, and end-of-day closeout.

## Operating flow

1. **Ready to ship** shows warehouse-routed order lines and package/address blockers.
2. **Picking** creates a durable pick list using the configured picking mode. Pick-to-order lists assign one reusable tote code per order.
3. **Pack & ship** verifies scanned SKUs and prevents excess quantities. Scan-to-pack and a second quality check are optional enforcement settings.
4. **Label batches** calculate fresh rates before any purchase. Bulk Refresh rates deliberately selects the cheapest eligible returned service and keeps the customer's requested delivery method and promised date beside the selected rate and carrier ETA for comparison. A batch contains at most 100 orders and is processed in durable chunks so partial progress survives a provider failure or restart.
5. **Print queue** combines purchased labels and optional packing slips into a printable PDF. Reprinting does not purchase another label.
6. **Shipments** is the retained label and tracking ledger. **Exceptions** collects package, address, rate, and purchase failures.
7. **Manifests** creates an internal carrier/date closeout. It does not claim an electronic carrier manifest unless a carrier integration explicitly supports one.

## Shipping automation rules

Rules are evaluated in ascending priority. Conditions can use channel, warehouse, destination, delivery method, package weight, and order value. The winning rule can select a preferred carrier/service, the cheapest rate, or the fastest rate. Every batch row saves the chosen rule, explanation, and other matching rules for audit.

The channel shipping-label defaults remain the fallback when no fulfillment rule matches. Carrier credentials continue to live in Channels.

## Package measurement fallback

Rate requests use one complete measurement source. DataPlus uses a saved order package first, then the catalog product's complete package dimensions and weight, then its complete item dimensions and weight. It never combines a partial order package with product measurements. Automatic product fallback is limited to one-SKU shipments; mixed-SKU shipments require an explicit packed-carton measurement.

## Safety and idempotency

- Creating a batch only calculates rates; it never buys labels.
- Labels above the configured channel cost limit require explicit confirmation.
- An order with an active label from another batch is skipped instead of repurchased.
- Purchased rows are durable and are not repurchased when a batch resumes.
- Failed rows remain visible and can be retried without replaying successful rows.
- Scan-to-pack and quality-check enforcement are opt-in so existing ready orders are not unexpectedly blocked.
- ZPL is provider/printer-specific. The combined print packet is a PDF workflow; use PDF or PNG label output when a merged packet is required.

## Settings

Fulfillment > Settings controls batch size, processing chunk size, picking mode, label size, packing-slip inclusion, scan enforcement, quality-check enforcement, and shipping automation rules. Keep batch size at or below 100. Smaller processing chunks reduce the impact of carrier throttling while preserving the same batch for the operator.
