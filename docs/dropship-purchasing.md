# Dropship purchasing

## Supplier modes

Vendor profile > PO Settings controls how paid customer demand becomes a purchase order.

- **Collect into draft PO** (`pooled`) is the default. Eligible lines collect by supplier and physical receiving warehouse until the supplier cutoff.
- **Dropship each customer order** (`dropship_per_order`) creates direct-to-customer POs. Orders for the same supplier, recipient, and exact delivery address may share one unsubmitted dropship PO; different addresses are always isolated.

Both modes create local drafts or ready-to-send POs only. They do not transmit a PO to the supplier without the normal buyer approval and submission action.

Supplier capability and automatic routing are separate Boolean controls. **Supplier can dropship** allows buyers to move selected pooled lines into direct-to-customer POs, but it never changes future order routing by itself. **Dropship all new orders** creates a direct-to-customer PO for every future order and is available only when the supplier can dropship. Turning it off returns future demand to pooled draft POs.

## Direct-to-customer safeguards

- A dropship PO stores one customer order identity and its ship-to address.
- Warehouse receiving is blocked in both the UI and API.
- Supplier tracking belongs on the linked customer order so channel fulfillment can use it.
- Retrying PO creation reuses an existing unsubmitted dropship PO for the same supplier, recipient, and exact delivery address.
- A draft pooled PO can split all eligible lines in one action. DataPlus groups them by supplier plus exact recipient and delivery address, preserving all linked customer order IDs on the resulting dropship PO.
- Disabled or inactive suppliers remain ineligible through the existing sourcing gates.

## Moving a pooled line

An unsubmitted and unreceived pooled PO line can be moved to its own dropship PO when the supplier allows dropshipping. The buyer selects a standardized operational reason; an additional note is optional. DataPlus then:

1. Creates a direct-to-customer PO for the linked order.
2. Removes the line from the pooled draft and recalculates its totals.
3. Relinks the order fulfillment route and purchase requirement.
4. Preserves audit events on the source PO, dropship PO, and customer order.

The PO line and whole-PO move actions require **Supplier can dropship**, but they do not enable **Dropship all new orders** or modify either vendor setting.

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

## PO save performance and audit identity

- Editing a purchase order performs one targeted PO write and returns the updated PO. It must not rebuild or return the global operational summary.
- Saving a supplier reference, CTech PO number, acknowledgement, or PO status also returns only the updated PO. The detail page applies that response directly for reference edits instead of rebuilding the global operational summary and then reloading the same PO.
- A manually started purchase order can be saved immediately as a draft, including before a supplier, receiving warehouse, or line item is complete. The saved PO shows every missing requirement and remains editable. Approval, placement, and supplier submission stay blocked until the supplier, physical receiving warehouse, and valid item lines are complete.
- The React detail page applies the returned PO immediately instead of issuing a second detail request after Save.
- Vendor and warehouse validation reads only those reference collections during an edit.
- PO creation and edit history use the authenticated DataPlus user as the authoritative actor. Client-supplied user names are display hints only and cannot override the signed-in identity.
