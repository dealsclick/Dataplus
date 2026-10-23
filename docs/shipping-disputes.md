# Shipping Disputes

Shipping Disputes is a dedicated Accounting workspace at `/accounting/shipping-disputes`. It creates shipment-level evidence packages for carrier or marketplace overcharge reviews without changing fulfillment, purchased labels, shipping settlements, or order P&L.

The operational order and shipment lookup is currently available only to LINQ USA dba Dealsclick. Other company workspaces are rejected until those shared operational tables complete tenant isolation.

## Intake and matching

The operator workflow has three deliberate stages:

1. **Upload report**: choose a supported file or paste order identifiers. This stage parses and previews the file locally and does not request rates.
2. **Review matched orders**: DataPlus creates one durable dispute per uploaded file, matches channel order IDs to canonical orders, and loads the order's normalized line items. Operators can search by DataPlus order, channel order, tracking number, SKU, or item title and use the Fulfillment-style multi-SKU picker to isolate one or several recurring product disputes.
3. **Compare rates**: request current rates for all ready shipments, only the filtered rows, a checkbox selection, or one shipment from its row menu.

Operators can paste DataPlus order numbers or channel order numbers separated by commas, semicolons, or new lines. They can also upload a CSV, TXT, XLSX, or XLS file up to 10 MB with a single identifier column. Recognized headers include DataPlus order, order number, order ID, channel order, marketplace order, external order, PO number, and reference. Excel workbooks use the first worksheet containing one of those headers, with the first non-empty worksheet as the fallback for a simple one-column file.

Excel parsing is loaded in the browser only after an Excel workbook is selected. The spreadsheet library is not part of the default Shipping Disputes page load, and the extracted identifiers continue through the same bounded server-side matching path as pasted or CSV identifiers.

Temu's full transaction report is recognized by the `Transaction type`, `Order ID`, and `Others` columns. DataPlus keeps only rows whose transaction type is exactly `Shipping label purchase adjustment`, uses the Temu order ID to match the operational order, and retains column `Others` as the signed statement amount. A negative statement amount is a shipping expense charge; a positive statement amount is a credit. DataPlus stores both the original signed amount and the normalized expense amount so the statement can always be reproduced without ambiguous sign conversion.

Every matching Temu row is retained as dispute evidence with its source row number, date, related ID, total, and currency. Multiple adjustments for one order are aggregated for matching and display while their individual rows remain in the item audit JSON and CSV row-detail column. The upload preview shows transaction count, unique orders, charges, credits, and net additional shipping expense before creation. One uploaded file creates one user-visible dispute with up to 50,000 unique order references. PostgreSQL matching, catalog enrichment, and inserts remain internally bounded to protect memory and query latency; these processing chunks never appear as separate dispute IDs.

Shipping-dispute intake does not write the accounting ledger or P&L. The complete Temu settlement import remains the authoritative reconciliation workflow. This prevents a transaction report used for quote evidence from posting the same shipping adjustment twice.

Each identifier is resolved against the canonical order record. A multi-package order produces one dispute item per physical shipment. Unmatched and ambiguous references remain visible for review instead of silently falling out of the batch. Canonical, mapped, and original channel SKU identities are retained from `order_line_items` so a dispute can be filtered even when a channel alias differs from the current catalog SKU. One bounded catalog lookup enriches those identities with the current product image, title, brand, supplier, and canonical product link. Imported order-line images remain the fallback when a catalog match is unavailable. Existing dispute batches receive the same read-time enrichment, and broken remote images degrade to the standard product placeholder instead of leaving a broken thumbnail. The complete line snapshot is also included in the CSV export.

The review toolbar combines free-text search, multiple SKU selections, match state, and statement effect. Match state supports all rows, matched orders only, or unmatched/ambiguous references only. Statement effect supports all rows, net charges, net credits, or rows with no net adjustment. **Quote filtered** sends only ready shipments remaining after every active filter. Checkbox quoting is also limited to the currently filtered ready set so hidden selections cannot be quoted accidentally. The table renders 100 filtered rows per page while filter and quote counts continue to cover the complete dispute.

The initial evidence snapshot contains:

- DataPlus and channel order identifiers.
- Shipment and tracking identifiers.
- Destination snapshot.
- Package weight and dimensions retained with the label-purchase financial record.
- Package measurement provenance.
- Original label purchase cost.
- Final carrier or channel billed cost.
- Settlement, invoice, and carrier-reported package evidence when available.

Temu transaction reports are financial evidence and are not expected to contain package dimensions. For current comparison quotes, DataPlus resolves the matched order lines to the current catalog SKU records and snapshots their stored shipping measurements into the dispute. Single-SKU orders are labeled **Current catalog SKU**; combined orders are labeled **Current catalog order estimate**. Any original label-purchase package remains separately retained in the item audit JSON and is never rewritten or presented as Temu-provided data.

An item is marked **Needs package data** only when neither the current catalog SKU measurements nor a complete retained package can produce a positive weight and all three dimensions. An operator may enter a dispute-only override, but a reason is required and the override is retained in the dispute audit record. This correction does not update the catalog, order, shipment, or shipping report history. Existing unquoted disputes are reconciled to current catalog measurements when opened so previously blocked matched rows become quote-ready without another upload. Already-quoted rows keep the package snapshot associated with their saved rates.

## Quote execution

Rate shopping runs as the `shipping-dispute-quotes` background job in the carrier-rates workload lane. Upload and order matching do not call carrier APIs. Provider calls are bounded to one dispute quote job at a time so a large upload cannot compete with label purchases or interactive fulfillment work. Selective jobs carry only dispute item IDs and mark only those rows as quoting; unselected rows remain available for later review.

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

The CSV export contains one row per physical shipment and flattens the five ranked rates into columns. It also includes all matched SKU identities, line-item detail, purchase and carrier-reported measurements, original and final costs, billing difference, settlement references, and the difference between the final bill and the lowest current comparison rate. Temu report batches add transaction type, original signed statement amount, normalized additional shipping expense, currency, row count, date range, and related IDs.

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
