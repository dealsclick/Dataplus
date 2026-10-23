# Shipping Disputes

Shipping Disputes is a dedicated Accounting workspace at `/accounting/shipping-disputes`. It creates shipment-level evidence packages for carrier or marketplace overcharge reviews without changing fulfillment, purchased labels, shipping settlements, or order P&L.

The operational order and shipment lookup is currently available only to LINQ USA dba Dealsclick. Other company workspaces are rejected until those shared operational tables complete tenant isolation.

## Intake and matching

Operators can paste DataPlus order numbers or channel order numbers separated by commas, semicolons, or new lines. They can also upload a CSV or text file with a single identifier column. Recognized CSV headers include DataPlus order, order number, order ID, channel order, and reference.

Each identifier is resolved against the canonical order record. A multi-package order produces one dispute item per physical shipment. Unmatched and ambiguous references remain visible for review instead of silently falling out of the batch.

The initial evidence snapshot contains:

- DataPlus and channel order identifiers.
- Shipment and tracking identifiers.
- Destination snapshot.
- Package weight and dimensions retained with the label-purchase financial record.
- Package measurement provenance.
- Original label purchase cost.
- Final carrier or channel billed cost.
- Settlement, invoice, and carrier-reported package evidence when available.

Current catalog dimensions are never substituted as historical purchase facts. When historical package data is incomplete, the item is marked **Needs package data**. An operator may enter corrected dispute-only measurements, but a reason is required and the override is retained in the dispute audit record. This correction does not update the order or shipment.

## Quote execution

Rate shopping runs as the `shipping-dispute-quotes` background job in the carrier-rates workload lane. Provider calls are bounded to one dispute quote job at a time so a large upload cannot compete with label purchases or interactive fulfillment work.

DataPlus requests comparison rates from:

- The existing Veeqo rate connection and its configured carrier accounts.
- The UPS Rating API when server-only negotiated-account credentials are configured.

Direct UPS configuration uses `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, and `UPS_ACCOUNT_NUMBER`. `UPS_TEST_MODE=true` uses the UPS customer integration environment. Credentials are never returned to the browser.

UPS references:

- [Rating API](https://developer.ups.com/tag/Rating?loc=en_US)
- [UPS API setup and negotiated-rate guidance](https://developer.ups.com/get-started)
- [OAuth client credentials](https://developer.ups.com/api/reference/oauth/client-credentials?loc=en_US)

Channel label rates are excluded from dispute shopping. Existing-label duplicate-purchase guards do not block the dispute because this workflow cannot buy a label. The rater receives an isolated order and package snapshot, and the operational order is never saved.

Each shipment run preserves an immutable request snapshot and request/response evidence hashes. DataPlus normalizes, sorts, and deduplicates valid provider responses, then stores only the five cheapest rates. A rerun creates a new quote run and leaves prior evidence intact.

## Accounting interpretation

The comparison rates are labeled as current evidence. They are not represented as historical re-rates because fuel, accessorial charges, negotiated discounts, address classification, and service availability can change.

The evidence hierarchy is:

1. Original label purchase cost and purchase package snapshot.
2. Final carrier or channel bill with settlement or invoice reference.
3. Current UPS and Veeqo comparison rates.

The CSV export contains one row per physical shipment and flattens the five ranked rates into columns. It also includes purchase and carrier-reported measurements, original and final costs, billing difference, settlement references, and the difference between the final bill and the lowest current comparison rate.

## Statuses

- **Needs review**: one or more references are unmatched, ambiguous, or missing quote evidence.
- **Ready to quote**: at least one matched shipment has complete destination and package data.
- **Quoting**: the background worker is requesting provider rates.
- **Ready**: every eligible shipment has saved comparison rates.
- **Partial**: quoted evidence exists, but at least one row failed or still needs review.

## Verification

Run:

```powershell
node scripts/test-shipping-disputes.cjs
npm run web:build
git diff --check
```

When testing direct UPS rates, use a non-production dispute batch first and confirm that the API response identifies the expected negotiated account. UPS test-environment discounts are not production negotiated rates.
