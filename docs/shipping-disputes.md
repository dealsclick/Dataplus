# Shipping Disputes

Shipping Disputes is a dedicated Accounting workspace at `/accounting/shipping-disputes`. It creates shipment-level evidence packages for carrier or marketplace overcharge reviews without changing fulfillment, purchased labels, shipping settlements, or order P&L.

The operational order and shipment lookup is currently available only to LINQ USA dba Dealsclick. Other company workspaces are rejected until those shared operational tables complete tenant isolation.

## Intake and matching

The operator workflow has three deliberate stages:

1. **Upload report**: choose a supported file or paste order identifiers. This stage parses and previews the file locally and does not request rates.
2. **Review matched orders**: DataPlus creates one durable dispute per uploaded file, matches channel order IDs to canonical orders, and loads the order's normalized line items. Operators can search by DataPlus order, channel order, tracking number, SKU, or item title and use the Fulfillment-style multi-SKU picker to isolate one or several recurring product disputes.
3. **Compare rates**: request current rates for all ready shipments, only the filtered rows, a checkbox selection, or one shipment from its row menu.

The recent-disputes rail is collapsed by default so the evidence table receives the full workspace width. **Recent disputes** in the active dispute header opens the rail, and the panel control hides it again without changing the selected dispute, filters, page, or quote state. The browser remembers this preference for the next visit.

Operators can paste DataPlus order numbers or channel order numbers separated by commas, semicolons, or new lines. They can also upload a CSV, TXT, XLSX, or XLS file up to 10 MB with a single identifier column. Recognized headers include DataPlus order, order number, order ID, channel order, marketplace order, external order, PO number, and reference. Excel workbooks use the first worksheet containing one of those headers, with the first non-empty worksheet as the fallback for a simple one-column file.

Excel parsing is loaded in the browser only after an Excel workbook is selected. The spreadsheet library is not part of the default Shipping Disputes page load, and the extracted identifiers continue through the same bounded server-side matching path as pasted or CSV identifiers.

Temu's full transaction report is recognized by the `Transaction type`, `Order ID`, and `Others` columns. DataPlus keeps only rows whose transaction type is exactly `Shipping label purchase adjustment` and whose signed `Others` amount is negative. These rows represent additional shipping charges. Positive adjustments, zero-value adjustments, and every other transaction type are excluded from order matching, dispute totals, stored evidence, and exports. The upload preview reports how many non-charge rows were ignored. For accepted rows, DataPlus retains the original negative signed amount and a positive additional-shipping-charge amount so the source statement remains auditable.

Every accepted Temu charge row is retained as dispute evidence with its source row number, date, related ID, total, and currency. Multiple charges for one order are aggregated for matching and display while their individual rows remain in the item audit JSON and CSV row-detail column. The upload preview shows charge count, unique orders, ignored non-charge rows, invalid charge rows, and total additional shipping expense before creation. One uploaded file creates one user-visible dispute with up to 50,000 unique order references. PostgreSQL matching, catalog enrichment, and inserts remain internally bounded to protect memory and query latency; these processing chunks never appear as separate dispute IDs.

Shipping-dispute intake does not write the accounting ledger or P&L. The complete Temu settlement import remains the authoritative reconciliation workflow. This prevents a transaction report used for quote evidence from posting the same shipping adjustment twice.

Each identifier is resolved against the canonical order record. A multi-package order produces one dispute item per physical shipment. Unmatched and ambiguous references remain visible for review instead of silently falling out of the batch. Canonical, mapped, and original channel SKU identities are retained from `order_line_items` so a dispute can be filtered even when a channel alias differs from the current catalog SKU. One bounded catalog lookup enriches those identities with the current product image, title, brand, supplier, and canonical product link. Imported order-line images remain the fallback when a catalog match is unavailable. Existing dispute batches receive the same read-time enrichment, and broken remote images degrade to the standard product placeholder instead of leaving a broken thumbnail. The complete line snapshot is also included in the CSV export.

The review toolbar combines free-text search, multiple SKU selections, match state, address status, and dimensions status. Match state supports all rows, matched orders only, or unmatched/ambiguous references only. Address status separates complete addresses from rows needing address review; completeness requires street, city, state, postal code, and country. Dimensions status separates complete quote packages from rows missing a positive weight, length, width, or height. Temu imports contain additional shipping charges only, so no credit/net-effect filter is shown. **Quote filtered** sends only ready shipments remaining after every active filter. Checkbox quoting is also limited to the currently filtered ready set so hidden selections cannot be quoted accidentally. The table renders 100 filtered rows per page while filter and quote counts continue to cover the complete dispute.

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

Rate shopping runs as the `shipping-dispute-quotes` background job in the carrier-rates workload lane. Upload and order matching do not call carrier APIs. A quote request can include every ready shipment in the dispute; DataPlus automatically divides the request into background jobs of at most 100 shipments and chains those jobs in order. The carrier-rates lane still permits only one quote chunk at a time, so a large upload remains memory-bounded and cannot create an unbounded burst of carrier calls. Each chunk loads only its own shipment rows, updates progress after each shipment, preserves a failed shipment for review, and continues with the remaining rows. Dispute totals are recalculated once per chunk instead of once per shipment. Selective jobs carry only dispute item IDs and mark only those rows as quoting; unselected rows remain available for later review.

DataPlus requests comparison rates from:

- The existing Veeqo rate connection and its configured carrier accounts.
- The UPS Rating API when server-only negotiated-account credentials are configured.

Direct UPS configuration is available in **System Settings > Fulfillment > Direct carrier accounts**. Production and test credentials are stored separately in the server-only `data/carrier-runtime-credentials.json` file, and the Client Secret is never returned to the browser. `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, and `UPS_ACCOUNT_NUMBER` remain supported as production fallbacks; `UPS_TEST_*` values are optional test-environment fallbacks.

UPS requests normalize United States state names and Canadian province names to the carrier's required postal abbreviations. This lets the shared DataPlus address model continue displaying values such as `New York` while the Rating API receives `NY`. The saved quote run also retains provider-level diagnostics. The comparison dialog shows whether Direct UPS and Veeqo returned rates, the cheapest amount each provider returned, whether a provider failed, and whether its rates ranked inside the five saved cheapest results. A successful provider can therefore remain visible even when none of its rates are retained in the top five.

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

The CSV export contains one row per physical shipment and flattens the five ranked rates into columns. It also includes all matched SKU identities, line-item detail, purchase and carrier-reported measurements, original and final costs, billing difference, settlement references, and the difference between the final bill and the lowest current comparison rate. Temu report batches add transaction type, original signed charge, normalized additional shipping charge, currency, accepted charge-row count, date range, and related IDs.

## Statuses

- **Needs review**: one or more references are unmatched, ambiguous, or missing quote evidence.
- **Ready to quote**: at least one matched shipment has complete destination and package data.
- **Quoting**: the background worker is requesting provider rates.
- **Ready**: every eligible shipment has saved comparison rates.
- **Partial**: quoted evidence exists, but at least one row failed or still needs review.

## Resetting the workspace

The signed-in superuser can use **Reset disputes** to permanently delete every shipping-dispute batch in the active tenant and company, including its shipment evidence snapshots, quote runs, and saved comparison rates. The reset does not delete or modify orders, purchased labels, shipping-cost records, settlements, carrier invoices, or accounting entries. It is blocked while any dispute quote run is active. When no other company's disputes remain, the next dispute display number restarts at `SD-00001`.

## Verification

Run:

```powershell
node scripts/test-shipping-disputes.cjs
npm run web:build
git diff --check
```

When testing direct UPS rates, use a non-production dispute batch first and confirm that the API response identifies the expected negotiated account. UPS test-environment discounts are not production negotiated rates.
