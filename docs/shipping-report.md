# Shipping report

The Shipping Report is a dedicated page available under **Reporting > Shipping Report** at `/reports/shipping`. It is an operational and accounting view of shipment revenue, label expense, carrier activity, data coverage, and shipping profitability. It remains independent from Sales Reports so opening either report does not load the other report's data.

## Accounting model

- Customer-paid shipping is revenue. It never substitutes for carrier or label expense.
- Purchased label cost is an estimate until a carrier invoice or channel settlement is reconciled.
- Reconciled actual cost replaces the estimate for reporting. The original quote, purchased cost, refund, and reconciliation evidence remain stored.
- Later shipping adjustments are added to the effective expense. Label refunds and credits reduce the purchased estimate.
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

- Summary metrics for shipment expense, customer shipping collected, shipping contribution, average cost, cost coverage, actual reconciled cost, adjustments, and credits.
- Daily, channel, destination-state, cost-basis, carrier, service, label-provider, and billing-status breakdowns.
- Category, supplier, and SKU shipping allocations.
- A server-paginated shipment ledger searchable by order, marketplace order, tracking number, shipment, customer, SKU, and product title.
- A detailed CSV containing order and shipment identities, carrier data, destination, package measurements, revenue, quote, estimate, refund, actual cost, adjustment, settlement, invoice, batch, print job, and reconciliation fields.

CSV exports are limited to 25,000 rows per request to keep reporting work bounded on the operational server. Narrow the date range or filters for larger histories.

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
- Settlement ID, invoice number, tracking status, batch, print job, and package evidence remain available in the shipment ledger export.

Current historical data can be mostly estimated until carrier invoice and channel settlement imports are matched. That state is shown prominently and does not get presented as final accounting.

## Design references

The report follows common shipping analytics and carrier-audit patterns:

- Shopify shipping-label reports expose label count, cost, and average cost per label, while delivery-performance reports use fulfillment, ship, and delivery timing: https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/order-reports
- Shopify profit reporting separates customer shipping charges from store-paid shipping costs: https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/profit-reports
- FedEx invoice detail includes service, zone, package, rated and actual weight, transportation, fuel, special charges, references, and delivery evidence: https://developer.fedex.com/content/dam/fedex/us-united-states/accounts/images/2020/Q2/FedEx_Billing_Online_Direct_Invoice_User_Guide_09182019_867086420.pdf

