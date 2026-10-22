const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const db = read("db.js");
const server = read("server.js");
const app = read("web/src/App.tsx");
const component = read("web/src/components/sales-shipping-report.tsx");
const charts = read("web/src/components/shipping-report-charts.tsx");
const ledger = read("web/src/components/shipping-report-ledger.tsx");
const docs = read("docs/shipping-report.md");

test("shipping reporting keeps revenue, estimates, and actual cost distinct", () => {
  assert.match(db, /order_shipping_revenue \/ active_shipment_count as allocated_shipping_revenue/);
  assert.match(db, /when actual_shipping_cost is not null then actual_shipping_cost/);
  assert.match(db, /when settlement_line_count > 0 then settlement_line_total/);
  assert.match(db, /coalesce\(estimated_shipping_cost, quoted_cost, 0\) - coalesce\(refunded_cost, 0\)/);
  assert.match(db, /order_shipping_adjustments \/ active_shipment_count as allocated_adjustment/);
  assert.match(db, /as billed_shipping_cost/);
  assert.match(db, /as calculated_dimensional_weight/);
  assert.match(db, /resolved_package_length \* resolved_package_width \* resolved_package_height \/ 139\.0/);
  assert.match(db, /package_snapshot\.package_weight/);
  assert.match(db, /stored_package_snapshot\.package_weight/);
  assert.match(db, /coalesce\(f\.package_weight, stored_package_snapshot\.package_weight, 0\) <= 0/);
  assert.doesNotMatch(db, /from unnest\(array\[/);
  assert.match(db, /o\.raw -> 'package' ->> 'packageLength'/);
  assert.match(db, /resolved_package_length \* resolved_package_width \* resolved_package_height \/ 139\.0/);
});

test("shipping reporting is bounded and supports the expected audit filters", () => {
  assert.match(db, /salesShippingReportingSummary/);
  assert.match(db, /salesShippingReportingShipments/);
  assert.match(db, /function shippingReportingFilterSpec[\s\S]*const params = \[\];\s+const baseWhere = \[\];/);
  assert.match(db, /statement_timeout = '45s'/);
  assert.match(db, /shipping_settlement_lines_matched_order_shipment_idx/);
  assert.match(db, /shipping_settlement_lines_matched_tracking_idx/);
  assert.match(db, /candidate_shipments as materialized/);
  assert.match(db, /where \$\{spec\.baseWhere\.length \? spec\.baseWhere\.join\(" and "\) : "true"\}/);
  assert.match(db, /settlement_match_candidates as \(/);
  assert.match(db, /settlement_charges_by_shipment as \(/);
  assert.match(db, /from settlement_match_candidates matched[\s\S]*join shipping_settlement_lines line on line\.line_id = matched\.line_id/);
  assert.doesNotMatch(db, /left join lateral \([\s\S]*from shipping_settlement_lines candidate/);
  assert.match(db, /create temp table shipping_report_rows[\s\S]*display_order_number[\s\S]*net_estimated_cost[\s\S]*from shipping_report_scope/);
  assert.match(db, /shippingReportingBaseSql\(spec, \{ includeHistoricalShipmentFallback: false, includeSettlementFallback: false \}\)/);
  assert.match(db, /settlementFallbackPredicate/);
  assert.match(db, /historicalShipmentFallbackPredicate/);
  assert.doesNotMatch(db, /create temp table shipping_report_rows[\s\S]*select \* from shipping_report_scope/);
  assert.doesNotMatch(db, /line\.line_id = f\.carrier_invoice_line_id\s+or/);
  assert.match(db, /const includeProfitability = options\.includeProfitability !== false/);
  assert.match(db, /if \(includeProfitability\) reportQueries\.push/);
  assert.match(db, /exportAll \? 25000/);
  assert.match(db, /includeVoided/);
  assert.match(db, /destinationState/);
  assert.match(db, /billingStatus/);
  assert.match(db, /costBasis/);
  assert.match(db, /dimensionStatus/);
  assert.match(db, /varianceStatus/);
});

test("shipping routes expose summary, paginated ledger, and CSV export", () => {
  assert.match(server, /\/api\/reports\/sales\/shipping\/export\.csv/);
  assert.match(server, /\/api\/reports\/sales\/shipping\/shipments/);
  assert.match(server, /\/api\/reports\/sales\/shipping"/);
  assert.match(server, /This export contains.*Narrow the date range or filters below 25,000 rows/);
  assert.match(server, /SHIPPING_REPORT_EXPORT_COLUMNS/);
  assert.match(server, /Carrier or channel billed cost/);
  assert.match(server, /shipping\/preferences/);
  assert.match(server, /includeProfitability: url\.searchParams\.get\("includeProfitability"\) !== "false"/);
  assert.match(server, /readUserTablePreference\(reportPreferenceUserId/);
});

test("new React app exposes shipping as a dedicated lazily loaded report", () => {
  assert.match(app, /const SalesShippingReport = lazy/);
  assert.match(app, /"shipping-reports": "\/reports\/shipping"/);
  assert.match(app, /id: "shipping-reports", label: "Shipping Report"/);
  assert.match(app, /function ShippingReportsPage\(\)/);
  assert.match(app, /view === "shipping-reports" && <ShippingReportsPage/);
  assert.match(app, /<SalesShippingReport from=\{applied\.from\}/);
  assert.doesNotMatch(app, /TabsTrigger value="shipping">Shipping<\/TabsTrigger><TabsTrigger value="products">Products and customers/);
  assert.match(component, /Shipping report/);
  assert.match(component, /Shipment ledger/);
  assert.match(component, /Shipping profitability/);
  assert.match(component, /Carrier billing audit/);
  assert.match(component, /ShippingReportLedger/);
  assert.match(component, /overviewMode/);
  assert.match(component, />Charts</);
  assert.match(component, />Raw data</);
  assert.match(component, /ShippingReportCharts/);
  assert.match(component, /if \(!active \|\| tab !== "shipments"\) return/);
  assert.match(component, /params\.set\("includeProfitability", "false"\)/);
  assert.match(component, /tab !== "profitability"/);
  assert.match(charts, /ChartContainer/);
  assert.match(charts, /Purchased rates versus billed cost/);
  assert.match(charts, /Package measurement quality/);
  assert.match(component, /Carrier invoices are not reconciled yet/);
  assert.match(ledger, /Displayed columns/);
  assert.match(ledger, /Saved template/);
  assert.match(ledger, /Calculated DIM weight \(139\)/);
  assert.match(ledger, /Export shipping audit/);
});

test("shipping product allocation and accounting rules are documented", () => {
  assert.match(db, /when order_product_sales > 0 then product_sales \/ order_product_sales/);
  assert.match(db, /when order_qty > 0 then qty \/ order_qty/);
  assert.match(docs, /Customer-paid shipping is revenue/);
  assert.match(docs, /Purchased label cost is an estimate/);
  assert.match(docs, /Reconciled actual cost replaces the estimate/);
  assert.match(docs, /Voided labels are excluded by default/);
  assert.match(docs, /historical package fallback/i);
});

