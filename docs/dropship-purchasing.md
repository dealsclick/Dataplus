# Dropship purchasing

## Supplier modes

Vendor profile > PO Settings controls how paid customer demand becomes a purchase order.

- **Collect into draft PO** (`pooled`) is the default. Eligible lines collect by supplier and physical receiving warehouse until the supplier cutoff.
- **Dropship each customer order** (`dropship_per_order`) creates one PO per customer order. Lines from different customer orders are never combined.

Both modes create local drafts or ready-to-send POs only. They do not transmit a PO to the supplier without the normal buyer approval and submission action.

## Direct-to-customer safeguards

- A dropship PO stores one customer order identity and its ship-to address.
- Warehouse receiving is blocked in both the UI and API.
- Supplier tracking belongs on the linked customer order so channel fulfillment can use it.
- Retrying PO creation reuses an existing unsubmitted dropship PO for the same supplier and customer order.
- Disabled or inactive suppliers remain ineligible through the existing sourcing gates.

## Moving a pooled line

An unsubmitted and unreceived pooled PO line can be moved to its own dropship PO when the supplier allows dropshipping. The buyer selects a standardized operational reason; an additional note is optional. DataPlus then:

1. Creates a direct-to-customer PO for the linked order.
2. Removes the line from the pooled draft and recalculates its totals.
3. Relinks the order fulfillment route and purchase requirement.
4. Preserves audit events on the source PO, dropship PO, and customer order.

Submitted, received, re-sourced, or already moved quantities cannot use this action.

## Converting existing open demand

After saving a supplier as **Dropship each customer order**, Vendor profile > PO Settings > Existing open demand can preview and queue conversion of eligible pooled demand. The preview is user-bound and expires after 30 minutes. The background job is retry-safe, combines eligible lines for the same supplier and customer order into one dropship PO, and reports progress in Jobs.

The conversion never changes submitted, acknowledged, received, re-sourced, canceled, missing-order, missing-route, or incomplete-address lines. Those remain in their original workflow for operator review.

Manual moves and bulk conversions use the same reason choices: expedited shipment, replacement order, cannot receive at warehouse, lower fulfillment cost, supplier ships direct only, customer requested direct shipment, warehouse inventory unavailable, or other operational reason. The stable reason code, readable label, and optional note are retained in the PO audit timeline.

## Operating recommendations

- Require buyer approval for new dropship suppliers until successful submissions and tracking updates are proven.
- Require complete customer ship-to data before supplier submission.
- Monitor unacknowledged and overdue dropship POs separately from inbound receiving POs.
- Keep supplier order confirmation, supplier order number, tracking, and cancellation state on the PO/order audit trail.
- Add automated exception alerts for address changes after submission, supplier rejection, partial acceptance, duplicate supplier submission, and missing tracking near the channel ship-by deadline.
