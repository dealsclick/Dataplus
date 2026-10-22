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
const worker = read("scripts/dataplus-worker.js");
const workerLanes = read("lib/worker-lanes.js");
const docs = read("docs/shipping-report.md");

test("shipping reporting keeps revenue, estimates, and actual cost distinct", () => {
  assert.match(db, /order_shipping_revenue \/ active_shipment_count as allocated_shipping_revenue/);
  assert.match(db, /when actual_shipping_cost is not null then actual_shipping_cost/);
  assert.match(db, /when settlement_line_count > 0 then settlement_line_total/);
  assert.doesNotMatch(db, /when order_shipping_adjustments <> 0 then greatest\(coalesce\(estimated_shipping_cost, quoted_cost, 0\).*end as billed_shipping_cost/);
  assert.match(db, /when order_shipping_adjustments <> 0 then 'adjusted'/);
  assert.match(db, /when settlement_line_count > 0 then 'matched_settlement'/);
  assert.match(db, /when order_shipping_adjustments <> 0 then 'recorded_adjustment'/);
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
  assert.match(db, /prefiltered_shipments as materialized/);
  assert.match(db, /canonical_shipment_groups as \(/);
  assert.match(db, /row_number\(\) over \([\s\S]*canonical_shipment_key/);
  assert.match(db, /count\(distinct[\s\S]*tracking:/);
  assert.match(db, /shippingRateActivity/);
  assert.match(db, /rate_package\.package_raw/);
  assert.match(db, /resolved_package_measurement_source/);
  assert.match(db, /dataplus_rate_request/);
  assert.match(db, /package_measurement_source/);
  assert.match(db, /function shippingReportingLabelSourceExpression[\s\S]*then 'temu'/);
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
  assert.match(db, /options\.exportPageSize \|\| 25000/);
  assert.match(db, /\(page - 1\) \* pageSize/);
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
  assert.match(server, /Final billed shipping cost/);
  assert.match(server, /Label purchase dimensions/);
  assert.match(server, /Carrier-reported dimensions/);
  assert.match(server, /\["label_origin", "Label generated by"/);
  assert.match(server, /\["package_measurement_source", "Package dimensions source"/);
  assert.match(server, /return "Local"/);
  assert.match(server, /SHIPPING_REPORT_PREFERENCE_VERSION = 2/);
  assert.match(server, /migrateShippingReportPreferences/);
  assert.match(server, /shipping\/preferences/);
  assert.match(server, /includeProfitability: url\.searchParams\.get\("includeProfitability"\) !== "false"/);
  assert.match(server, /readUserTablePreference\(reportPreferenceUserId/);
});

test("long-range shipping exports are bounded background jobs", () => {
  assert.match(server, /POST" && url\.pathname === "\/api\/reports\/sales\/shipping\/exports"/);
  assert.match(server, /function shippingReportExportWindows/);
  assert.match(server, /SHIPPING_REPORT_EXPORT_WINDOW_DAYS = 31/);
  assert.match(server, /SHIPPING_REPORT_EXPORT_BATCH_SIZE = 1000/);
  assert.match(server, /SHIPPING_REPORT_EXPORT_MAX_ROWS = 250000/);
  assert.match(server, /dynamicTotal: true/);
  assert.match(server, /dynamicTotal && Number\(job\.progressPercent \|\| 0\) < 100/);
  assert.match(server, /async function runShippingReportExportWorkerJob/);
  assert.match(server, /fs\.createWriteStream\(filePath/);
  assert.match(server, /exportPageSize: SHIPPING_REPORT_EXPORT_BATCH_SIZE/);
  assert.match(server, /runShippingReportExportWorkerJob,/);
  assert.match(worker, /"shipping-report-export"/);
  assert.match(worker, /dataplus\.runShippingReportExportWorkerJob\(job\)/);
  assert.match(workerLanes, /'shipping-report-export': \{ lane: 'report-export', limit: 1 \}/);
  assert.match(ledger, /\/api\/reports\/sales\/shipping\/exports/);
  assert.match(ledger, /Queueing export/);
  assert.doesNotMatch(ledger, /window\.location\.assign\(`\/api\/reports\/sales\/shipping\/export\.csv/);
  assert.match(docs, /background jobs/);
  assert.match(docs, /31-day windows/);
  assert.match(docs, /1,000-row database pages/);
});

test("shipping export worker streams non-overlapping long-range windows and retries cleanly", async () => {
  const postgres = require("../db");
  const { runShippingReportExportWorkerJob } = require("../server");
  const originals = {
    salesShippingReportingShipments: postgres.salesShippingReportingShipments,
    readOperationJob: postgres.readOperationJob,
    upsertOperationArtifact: postgres.upsertOperationArtifact,
    upsertOperationJob: postgres.upsertOperationJob,
  };
  const calls = [];
  const job = {
    id: `shipping-report-export-test-${process.pid}-${Date.now()}`,
    fileName: "shipping-report-test.csv",
    workerPayload: {
      reportOptions: { from: "2026-06-01", to: "2026-10-01", dateBasis: "order" },
      columnIds: ["order_number", "net_purchased_cost"],
    },
  };
  let artifactDir = "";
  try {
    postgres.salesShippingReportingShipments = async (options) => {
      calls.push({ from: options.from, to: options.to, page: options.page, exportPageSize: options.exportPageSize });
      return { total: 1, rows: [{ display_order_number: `ORDER-${options.from}`, net_estimated_cost: 1.25 }] };
    };
    postgres.readOperationJob = async () => job;
    postgres.upsertOperationArtifact = async () => {};
    postgres.upsertOperationJob = async () => {};

    const first = await runShippingReportExportWorkerJob(job);
    artifactDir = path.dirname(first.originalFilePath);
    const firstCsv = fs.readFileSync(first.originalFilePath, "utf8").trim().split(/\r?\n/);
    assert.equal(calls.length, 4);
    assert.equal(firstCsv.length, 5);
    assert.equal(firstCsv[0], "Order number,Net purchased label cost");
    assert.deepEqual(calls.map(({ from, to }) => ({ from, to })), [
      { from: "2026-09-01", to: "2026-10-01" },
      { from: "2026-08-01", to: "2026-08-31" },
      { from: "2026-07-01", to: "2026-07-31" },
      { from: "2026-06-01", to: "2026-06-30" },
    ]);
    assert.ok(calls.every((call) => call.exportPageSize === 1000));

    await runShippingReportExportWorkerJob(job);
    const retriedCsv = fs.readFileSync(first.originalFilePath, "utf8").trim().split(/\r?\n/);
    assert.equal(retriedCsv.length, 5);
  } finally {
    Object.assign(postgres, originals);
    if (artifactDir && path.basename(artifactDir) === job.id) fs.rmSync(artifactDir, { recursive: true, force: true });
  }
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
  assert.match(component, /readWorkspaceCache<ShippingReportData>/);
  assert.match(component, /writeWorkspaceCache\(cacheKey, result\)/);
  assert.match(component, /tab !== "profitability"/);
  assert.match(charts, /ChartContainer/);
  assert.match(charts, /Purchased labels versus final billed cost/);
  assert.match(charts, /Package measurement quality/);
  assert.match(component, /Shipping bills are not reconciled yet/);
  assert.match(ledger, /Displayed columns/);
  assert.match(ledger, /Saved template/);
  assert.match(ledger, /Purchase DIM weight \(139\)/);
  assert.match(ledger, /Label purchase measurements/);
  assert.match(ledger, /Carrier-reported measurements/);
  assert.match(ledger, /id: "label_origin", label: "Label generated by"/);
  assert.match(ledger, /id: "package_measurement_source", label: "Package dims source"/);
  assert.match(ledger, /migrated\[index\] === "label_source"/);
  assert.match(ledger, /SHIPPING_REPORT_PREFERENCE_VERSION = 2/);
  assert.doesNotMatch(ledger, /id: "package_length", label: "Entered length"/);
  assert.doesNotMatch(ledger, /id: "carrier_billed_length", label: "Carrier billed length"/);
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
  assert.match(docs, /same order and normalized tracking number/i);
  assert.match(docs, /rate-request package snapshot/i);
  assert.match(docs, /Label purchase measurements/);
  assert.match(docs, /Carrier-reported measurements/);
  assert.match(docs, /Package dims source/);
  assert.match(docs, /Historical - unknown/);
  assert.match(docs, /not treated as final billed cost without invoice or settlement evidence/);
});

