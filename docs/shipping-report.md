# Shipping report

The Shipping Report is a dedicated page available under **Reporting > Shipping Report** at `/reports/shipping`. It is an operational, carrier-audit, and accounting view of package measurements, label rates, final billing, shipment revenue, and shipping profitability. It remains independent from Sales Reports so opening either report does not load the other report's data.

## Accounting model

- Customer-paid shipping is revenue. It never substitutes for carrier or label expense.
- Purchased label cost is an estimate until a carrier invoice or channel settlement is reconciled.
- Reconciled actual cost replaces the estimate for reporting. The original quote, purchased cost, refund, adjustment, and reconciliation evidence remain stored as separate fields.
- A matched carrier invoice line is final billing evidence. A channel shipping adjustment is displayed as channel billing evidence when a carrier invoice has not been matched.
- Temu monthly transaction imports treat `Shipping label purchase` plus every signed `Shipping label purchase adjustment` as the reconciled channel-billed shipping cost. The original estimated label cost remains available for variance comparison.
- The lazily loaded **Channel settlements** tab compares DataPlus Temu label purchases with all Temu statement shipping charges, matched charges, unmatched charges, return shipping, and label adjustments. Its transaction-type table preserves the signed statement amount and shows shipping-cost and channel-fee impacts separately.
- Later shipping adjustments are added to the net purchased rate only when no authoritative reconciled cost exists. This prevents the same charge from being counted twice.
- Billed variance is carrier or channel billed cost minus the purchased label cost after refunds and credits.
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

- Summary metrics for shipment expense, purchased label rates, carrier/channel billed cost, billed variance, measurement coverage, customer shipping collected, shipping contribution, adjustments, and credits appear first. Report filters sit immediately below those totals.
- The Overview opens in a shadcn chart view for daily purchased-versus-billed cost, channel cost, destination expense, and package-measurement quality. The Raw data toggle restores the exact accounting tables without changing the active filters.
- Daily, channel, destination-state, cost-basis, carrier, service, label-provider, and billing-status breakdowns.
- A carrier billing audit compares quoted, purchased, and billed amounts by carrier, service, channel, billing evidence, and package-measurement status.
- Category, supplier, and SKU shipping allocations.
- A server-paginated shipment ledger searchable by order, marketplace order, tracking number, shipment, customer, SKU, and product title. Users choose which audit columns are visible; the layout is saved per signed-in user.
- A detailed CSV with selectable columns for order and shipment identities, carrier data, destination, entered and carrier-rated package measurements, revenue, quote, purchased rate, refund, billed cost, adjustment, variance, settlement, invoice, batch, print job, and reconciliation fields.
- Named export templates save reusable column selections per signed-in user. Date ranges and report filters are intentionally not frozen into a template; the current view is applied when the export runs.

CSV exports are limited to 25,000 rows per request to keep reporting work bounded on the operational server. Narrow the date range or filters for larger histories.

## Package and carrier audit

The shipment ledger keeps the package data entered at label purchase separate from measurements received later from a carrier invoice:

- Entered weight, length, width, and height.
- Calculated dimensional weight using `length x width x height / 139` for the current parcel-audit comparison.
- Calculated billable weight as the greater of entered actual weight and calculated dimensional weight.
- Carrier actual, rated, dimensional, and billed weight when the settlement importer supplies them.
- Carrier-billed dimensions, units, zone, package type, charge types, and descriptions when supplied.
- Original quote, purchased label rate, refund or credit, adjustment, billed cost, and variance.

Package measurements are normalized from the shipment package object, the provider's first package record, direct legacy shipment fields, or the saved order-level package. The historical package fallback reads the shipment snapshot already stored with each financial row first. It scans the larger order shipment history only for an older row that still has an incomplete package after that lookup, so historical dimensions remain available without making every report row repeat the expensive scan.

The initial report request loads summary and chart data only. The paginated shipment ledger starts when the operator opens **Shipment ledger**, and category, supplier, and SKU allocations start when the operator opens **Shipping profitability**. This prevents unused detail work from competing with the first page load while keeping every tab available on demand.

Run `node scripts/test-sales-shipping-report-postgres.cjs` with `DATABASE_URL` pointing to an isolated database ending in `_shipping_report_test` when changing package normalization or the historical fallback.

The report never overwrites entered measurements with carrier measurements. This makes reweighs, dimensional corrections, address corrections, fuel charges, and channel label adjustments reviewable. The 139 divisor is a report calculation, not a claim that every carrier contract uses the same divisor; imported carrier-rated weight remains the authoritative billing evidence.

The billing-evidence value explains the number being compared:

- **Carrier invoice**: a reconciled shipment cost or matched settlement line.
- **Channel adjustment**: a later shipping adjustment, such as a marketplace label-purchase adjustment, applied to the net purchased rate.
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

- **Cost coverage** distinguishes reconciled, estimated, and missing shipment costs.
- **Reconciliation coverage** shows the share backed by actual carrier or channel charges.
- **Package coverage** shows records with weight and all three dimensions.
- **Billing coverage** shows shipments with carrier invoice or channel adjustment evidence.
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

