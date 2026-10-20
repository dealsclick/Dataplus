# Fulfillment operations

## Multi-line marketplace orders

- Fulfillment identity is scoped to the order and source line. Reused marketplace line numbers must never overwrite another order's line.
- Shipment records that share a tracking number are one physical shipment, but their distinct order lines are merged into the fulfillment history view. Tracking-number deduplication must not drop later lines.
- A routed line suppresses shipment-history fallback only for that same order line, not for every line on the order.
- Marketplace refreshes reconcile saved route SKU, title, and product identity from the route's authoritative `lineIndex`. Shipment, label-purchase, and tracking evidence remain unchanged.
- Use `node scripts/repair-fulfillment-route-line-identities.cjs --orders=<comma-separated-order-numbers>` to preview historical route drift. Add `--apply` only after reviewing the exact affected routes. Active routes linked to a purchase order are skipped; terminal routes may have display identity repaired without changing the linked PO.

Warehouse desktops can be paired under **Fulfillment > Print stations** so purchased print-queue packets can be sent from mobile to a specific printer. See [Desktop Print Agent](desktop-print-agent.md) for setup, security, and troubleshooting.

DataPlus Fulfillment is the warehouse workspace for picking, packing, carrier-rate selection, bulk label purchase, printing, shipment review, exceptions, and end-of-day closeout.

## Operating flow

1. **Ready to ship** shows warehouse-routed order lines and package/address blockers.
2. **Picking** creates a durable pick list using the configured picking mode. Pick-to-order lists assign one reusable tote code per order.
3. **Pack & ship** verifies scanned SKUs and prevents excess quantities. Scan-to-pack and a second quality check are optional enforcement settings.
4. **Label batches** calculate fresh rates before any purchase. Bulk Refresh rates deliberately selects the cheapest eligible returned service and keeps the customer's requested delivery method and promised date beside the selected rate and carrier ETA for comparison. A batch contains at most 100 orders and is processed in durable chunks so partial progress survives a provider failure or restart.
5. **Print queue** combines purchased labels and optional packing slips into a printable PDF. Reprinting does not purchase another label.

Packing-slip text is normalized for the built-in PDF font, and Temu's original product name is preferred when the localized marketplace title contains unsupported characters. A localized title can never make an otherwise valid purchased label packet unprintable.

Opening or reprinting a purchased label defaults to a carrier label followed by its 4 x 6 packing slip. Operators can still choose label-only or a Letter packing slip in the print dialog before printing.
6. **Shipments** is the retained label and tracking ledger. **Exceptions** collects package, address, rate, and purchase failures.
7. **Manifests** creates an internal carrier/date closeout. It does not claim an electronic carrier manifest unless a carrier integration explicitly supports one.

## Purchased-label filters

The Purchased labels queue filters the fulfillment snapshot already loaded in the browser, so changing a filter does not call a marketplace or reload the queue. Carrier, supplier, SKU, channel, label source, marketplace-update status, and print status options include the number of matching labels. SKU counts provide the queue's SKU breakdown, and Clear filters restores the full purchased-label view. Supplier names are projected from the order's fulfillment route and catalog product without adding a separate page request.

Print status treats a retained print count as printed even when an older shipment has no `labelPrintedAt` timestamp. Label source distinguishes labels purchased by DataPlus from marketplace-provided labels. Marketplace-update status remains separate from label purchase: a label can be complete locally while its channel acknowledgement is pending or failed.

## Shipping automation rules

Rules are evaluated in ascending priority. Conditions can use channel, warehouse, destination, delivery method, package weight, and order value. The winning rule can select a preferred carrier/service, the cheapest rate, or the fastest rate. Every batch row saves the chosen rule, explanation, and other matching rules for audit.

The channel shipping-label defaults remain the fallback when no fulfillment rule matches. Carrier credentials continue to live in Channels.

## Package measurement fallback

Rate requests use one complete measurement source. DataPlus uses a saved order package first, then the catalog product's complete package dimensions and weight, then its complete item dimensions and weight. It never combines a partial order package with product measurements. Automatic product fallback is limited to one-SKU shipments; mixed-SKU shipments require an explicit packed-carton measurement.

## Split shipments

The fulfillment row Actions menu includes **Set number of labels**. The operator chooses the total number of physical packages for the order; DataPlus preserves the exact routed unit quantity, distributes whole units across that many package groups, and gives every group its own label/rate identity. Choosing one label rejoins an existing split.

Splitting is allowed only for warehouse routes before picking, label batching, or label purchase begins. It is blocked for dropship/PO routes and any shipment with active tracking or purchased-label evidence. Changing the label count releases every non-purchased rate row for that order, clears saved quotes, and requires each new package group to be reviewed and rated again. Temu package counts remain marketplace-controlled: split the order in Temu and refresh DataPlus rather than creating unsupported local Temu labels.

Multi-line projection and route identity protections apply equally to eBay, Shopify, Temu, and Walmart. Source line identity is always scoped to its order; terminal route display metadata can be repaired without changing shipment, tracking, label, or purchasing evidence.

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
