# Shipping report

The Shipping Report is a dedicated page available under **Reporting > Shipping Report** at `/reports/shipping`. It is an operational, carrier-audit, and accounting view of package measurements, label rates, final billing, shipment revenue, and shipping profitability. It remains independent from Sales Reports so opening either report does not load the other report's data.

## Accounting model

- Customer-paid shipping is revenue. It never substitutes for carrier or label expense.
- Purchased label cost is an estimate until a carrier invoice or channel settlement is reconciled.
- Reconciled actual cost replaces the estimate for reporting. The original quote, purchased cost, refund, adjustment, and reconciliation evidence remain stored as separate fields.
- A matched carrier invoice line or channel settlement line is final billing evidence. An internal recorded adjustment remains provisional until it is linked to external billing evidence.
- Temu monthly transaction imports treat `Shipping label purchase` plus every signed `Shipping label purchase adjustment` as the reconciled channel-billed shipping cost. The original estimated label cost remains available for variance comparison.
- Temu label purchases retain the selected rate on both the fulfillment batch row and the order shipment. Deployment reconciliation repairs older cost, DataPlus purchase-origin, and batch-link fields from the exact retained batch shipment ID; it never estimates a missing amount from product or destination data.
- Temu statement shipping lines can reconcile to the DataPlus label record when channel import and label purchase created duplicate records for the same tracking/package identity. The matcher prefers the DataPlus purchase record only when that physical identity is unambiguous; unresolved multi-package cases remain in review.
- The lazily loaded **Channel settlements** tab compares DataPlus Temu label purchases with all Temu statement shipping charges, matched charges, unmatched charges, return shipping, and label adjustments. Its transaction-type table preserves the signed statement amount and shows shipping-cost and channel-fee impacts separately.
- Recorded shipping adjustments are added to the net purchased label cost only when no authoritative reconciled cost exists. They may affect the provisional P&L expense, but they are not presented as a final bill without external evidence. This prevents the same charge from being counted twice.
- Final cost variance is final billed shipping cost minus the purchased label cost after refunds and credits. It remains blank until a carrier invoice or channel settlement is matched.
- Shipping contribution is customer shipping collected minus effective shipping expense.
- Shipping burden is effective shipping expense divided by net sales for shipment-level breakdowns, or product sales for line-level breakdowns.
- Voided labels are excluded by default. They can be included explicitly for audit work.
- Canceled orders remain visible when a label or shipment record still represents a possible expense, refund, or recovery action.

## Date bases

The shared Sales date range and channel filters apply to the report. Shipping also supports three date bases:

- **Order date**: attributes shipping economics to the order date and is the default profitability view.
- **Label activity date**: uses label purchase, shipment, or record creation time to review operational spend.
- **Ship date**: uses ship time when present and falls back to label activity when historical data is incomplete.

## Available views

- Summary metrics for shipment expense, purchased label rates, final billed shipping cost, final cost variance, label purchase measurement coverage, customer-paid shipping revenue, shipping contribution, recorded adjustments, and credits appear first. Report filters sit immediately below those totals.
- The Overview opens in a shadcn chart view for daily purchased-versus-billed cost, channel cost, destination expense, and package-measurement quality. The Raw data toggle restores the exact accounting tables without changing the active filters.
- Daily, channel, destination-state, cost-basis, carrier, service, label-provider, and billing-status breakdowns.
- A carrier billing audit compares quoted, purchased, and final billed amounts by carrier, service, channel, cost evidence, and label purchase measurement status.
- Category, supplier, and SKU shipping allocations.
- A server-paginated shipment ledger searchable by order, marketplace order, tracking number, shipment, customer, SKU, and product title. Users choose which audit columns are visible; the layout is saved per signed-in user.
- **Purchased through** answers where the operator initiated the label workflow. New label purchases store a durable `purchase_origin` value of `dataplus` or `external`; the provider that issued the PDF is recorded separately. A fulfillment batch or print job is not purchase evidence because an externally purchased label can later be printed in DataPlus. Historical records use conclusive source evidence when available and otherwise display **Unknown**.
- **Label provider** answers which service issued or supplied the label, such as eBay, Walmart, Temu, Shopify, or Veeqo. It does not imply where the operator clicked Buy labels.
- **Technical source code** retains the raw stored source for audit and troubleshooting. It is not intended as the operator-facing purchase-workflow answer.
- Separate **Purchased through** and **Label provider** filters let accounting isolate DataPlus-initiated purchases without losing the issuer or channel distinction.
- **Package dims source** sits beside the purchase dimensions and states whether those measurements came from DataPlus or were imported from the order's channel. DataPlus measurements are further identified as manual, rate-request, fulfillment-derived, or saved-package values. Older rows without reliable lineage display **Historical - unknown** instead of being guessed.
- A detailed CSV with selectable columns for order and shipment identities, carrier data, destination, label purchase and carrier-reported measurements, revenue, quote, purchased amount, refund, final billed cost, recorded adjustment, variance, settlement, invoice, batch, print job, and reconciliation fields.
- Named export templates save reusable column selections per signed-in user. Date ranges and report filters are intentionally not frozen into a template; the current view is applied when the export runs.

CSV exports run as background jobs instead of holding a browser request open. The worker splits long date ranges into non-overlapping 31-day windows, reads each window in 1,000-row database pages, and streams rows directly into a retained job artifact. This supports quarter, year-to-date, and other ranges longer than 60 days without loading the full CSV into application memory or depending on the web proxy timeout. Progress and the completed download remain available under **Jobs**. The total expands as each date window is discovered, so the job cannot be inferred complete at an intermediate window boundary. A single export is capped at 250,000 shipment rows; larger histories should be split into multiple accounting files.

## Package and carrier audit

The shipment ledger keeps the package data used for label purchase separate from measurements received later from a carrier invoice or channel settlement:

- **Label purchase measurements**: weight, length, width, and height attached to the rate or label record. These may have been entered or calculated in DataPlus, or imported with a marketplace-provided label.
- **Package dims source**: the provenance of the label-purchase dimensions, shown as **DataPlus - ...**, **Imported - channel**, **Historical - unknown**, or **No complete dimensions**.
- **Purchase DIM weight**: `length x width x height / 139` for the current parcel-audit comparison.
- **Purchase billable weight**: the greater of the label purchase weight and purchase DIM weight.
- **Carrier-reported measurements**: actual, rated, dimensional, and billed weight supplied by a carrier invoice or channel settlement.
- **Carrier-reported dimensions**: length, width, height, units, zone, package type, charge types, and descriptions supplied by external billing evidence.
- **Shipping amounts**: original quote, purchased label amount, refund or void credit, recorded adjustment, final billed shipping cost, and final cost variance.

The interactive ledger displays one combined dimensions column for label purchase and one for carrier-reported measurements. CSV exports also expose numeric length, width, and height columns separately so accounting can sort, calculate, and compare them without parsing a display string.

Package measurements are normalized from the shipment package object, the provider's first package record, direct legacy shipment fields, or the saved order-level package. New shipment-financial records persist `package_measurement_source` with the dimensions. The first-load summary uses normalized shipment fields plus the saved shipment and order package snapshots; it does not walk every order's full legacy `raw.shipments` history. The paginated shipment ledger retains that deeper historical package fallback for an older row that is still incomplete, so detailed historical dimensions remain available without making every summary row repeat the expensive scan. When an older record cannot prove whether dimensions were local or imported, the report says **Historical - unknown**.

One physical shipment is represented once. Active records with the same order and normalized tracking number (or the same marketplace package number when tracking is unavailable) are treated as one canonical shipment. Cost, reconciliation, and package evidence are retained from the strongest member of that group, so a channel-import copy cannot create a second missing-cost row beside the purchased-label row. Voided records remain separate audit evidence when the operator includes voided labels.

For older marketplace labels where the provider record failed to retain its package object, the report can recover the nearest saved rate-request package snapshot from the order. That snapshot is the package DataPlus used while loading the rate; current catalog dimensions are not substituted as historical facts. New label purchases defensively copy the selected package onto the shipment, and marketplace imports merge by tracking number or marketplace package number so a later refresh does not recreate the duplicate.

For example, a Temu label retrieved through a DataPlus buy-label workflow is displayed as **Purchased through: DataPlus** and **Label provider: Temu**. A label bought in Temu and later imported or printed in DataPlus is displayed as **Purchased through: Outside DataPlus** and **Label provider: Temu**. Printing or batching never changes the stored purchase origin.

The initial report request loads summary and chart data only. The paginated shipment ledger starts when the operator opens **Shipment ledger**, and category, supplier, and SKU allocations start when the operator opens **Shipping profitability**. This prevents unused detail work from competing with the first page load while keeping every tab available on demand.

The screen, paginated ledger, and background CSV use the same filters and accounting projection. Export templates change only the selected columns; they do not change dates, channels, cost evidence, dimension status, void handling, or search scope. A long-range export therefore reconciles to the same filtered ledger population without blocking the interactive report.

Recently viewed summary results use the shared five-minute workspace cache. Returning to the same report range and filters displays that cached result immediately while a fresh request runs quietly; any successful application mutation invalidates the client workspace cache.

The report materializes the date range and other inexpensive shipment filters before order JSON package recovery or any aggregate runs. Its first-load temporary table retains only the accounting and grouping columns used by the summary and charts. Reconciled imports already persist their final cost on the shipment financial record, so the summary reads that authoritative value directly instead of rematching the settlement ledger on every request. Ledger-only settlement descriptions, carrier details, references, raw metadata, and indexed fallback matching stay on the paginated ledger path. For the normal ledger view, canonical shipment identities are counted and paginated first; only the visible page is then enriched with settlement, package, tracking, and item details. Filters that depend on enriched values retain the full accuracy-first path. The ledger's fallback matching uses explicit invoice line, order and shipment, tracking number, and single-shipment order indexes, and deduplicates matching lines before totaling them. This prevents a 30-day first load from scanning and enriching the complete settlement history or materializing unused detail while preserving full audit evidence on demand.

Run `node scripts/test-sales-shipping-report-postgres.cjs` with `DATABASE_URL` pointing to an isolated database ending in `_shipping_report_test` when changing package normalization or the historical fallback.

The report never overwrites label purchase measurements with carrier-reported measurements. This makes reweighs, dimensional corrections, address corrections, fuel charges, and channel label adjustments reviewable. The 139 divisor is a report calculation, not a claim that every carrier contract uses the same divisor; imported carrier-rated weight remains the authoritative billing evidence.

The cost-evidence value explains the number being used:

- **Carrier invoice**: a reconciled shipment cost backed by a carrier invoice and line reference.
- **Matched settlement**: a reconciled channel shipping charge backed by a settlement ID and transaction or line reference.
- **Recorded adjustment**: a provisional shipping adjustment recorded in DataPlus. It can affect P&L expense but is not treated as final billed cost without invoice or settlement evidence.
- **Label purchase**: the purchased label estimate is still the best available cost.
- **Quote only**: only the quoted rate is available.
- **Missing**: no usable shipping cost evidence exists.

## Allocation rules

Order-level customer shipping revenue and net sales are divided across active shipment records. This prevents multi-label orders from duplicating order totals.

For category, supplier, and SKU analysis, each order's shipping revenue and expense are allocated to its lines using this order:

1. Merchandise sales share.
2. Quantity share when line sales are unavailable.
3. Equal share when neither sales nor quantity is available.

Allocation is a reporting method, not a mutation of orders, shipment costs, or product records.

## Data quality

The report exposes rather than hides missing data:

- **Cost coverage** distinguishes reconciled, adjusted, estimated, and missing shipment costs.
- **Reconciliation coverage** shows the share backed by actual carrier or channel charges.
- **Package coverage** shows records with weight and all three dimensions.
- **Billing coverage** shows shipments with matched carrier invoice or channel settlement evidence.
- Settlement ID, invoice number, source file/API reference, adjustment reference/reason, tracking status, batch, print job, and package evidence remain available in the shipment ledger export.

Current historical data can be mostly estimated until carrier invoice and channel settlement imports are matched. That state is shown prominently and does not get presented as final accounting.

## Temu transaction classification

The shipping report displays every imported Temu transaction type, but only shipping rows affect shipping expense:

- `Shipping label purchase` and `Shipping label purchase adjustment` affect outbound shipping cost.
- `Shipping label for return purchase`, its adjustment, and `Return shipping-Pickup fee credit` affect return shipping cost. Platform-covered return rows remain visible as evidence and use their signed imported amount.
- `Order Payment` affects order revenue and marketplace service fees.
- `Refund` affects refunds and any associated marketplace-fee credit.
- `Advertising service fee` is channel overhead and is not assigned to carrier expense.
- `Chargeback processing fee` and `Fraudulent fulfillment deduction` are channel fees or deductions, not shipping cost.
- `Platform reimbursement` is a channel credit.
- `Transfer` and `Transfer of funds unsuccessful` are cash-movement evidence. They do not create revenue, fees, or shipping cost by themselves.

This separation prevents a payout transfer, refund, advertising charge, or chargeback from being counted as carrier spend while keeping the full statement visible for accounting review.

## Design references

The report follows common shipping analytics and carrier-audit patterns:

- Shopify shipping-label reports expose label count, cost, and average cost per label, while delivery-performance reports use fulfillment, ship, and delivery timing: https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/order-reports
- Shopify profit reporting separates customer shipping charges from store-paid shipping costs: https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/profit-reports
- FedEx invoice detail includes service, zone, package, rated and actual weight, transportation, fuel, special charges, references, and delivery evidence: https://developer.fedex.com/content/dam/fedex/us-united-states/accounts/images/2020/Q2/FedEx_Billing_Online_Direct_Invoice_User_Guide_09182019_867086420.pdf

