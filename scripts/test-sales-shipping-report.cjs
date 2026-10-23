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
  assert.match(db, /case when estimated_shipping_cost is not null[\s\S]*as net_purchased_label_cost/);
  assert.match(db, /sum\(net_purchased_label_cost\) filter \(where billed_shipping_cost is not null\).*as reconciled_purchase_cost/);
  assert.match(db, /sum\(net_purchased_label_cost\) filter \(where billed_shipping_cost is null\).*as unreconciled_purchase_cost/);
  assert.match(db, /sum\(billed_shipping_cost\) filter \(where net_purchased_label_cost is not null\).*as matched_billed_cost/);
  assert.match(db, /billed_shipping_cost is not null and net_purchased_label_cost is null.*as billed_without_purchase_count/);
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
  assert.match(db, /RELATIONAL_SCHEMA_VERSION = "2026-10-23-shipping-purchase-origin-v1"/);
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
  assert.match(db, /function shippingReportingPurchaseOriginExpression[\s\S]*purchase_origin[\s\S]*then 'dataplus'[\s\S]*then 'external'/);
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
  assert.match(db, /candidate_shipment_total as \(/);
  assert.match(db, /const canPageBeforeEnrichment = !exportAll && spec\.where\.length === 0/);
  assert.match(db, /candidatePagination: \{ limitParameter:/);
  assert.match(db, /includeVoided/);
  assert.match(db, /destinationState/);
  assert.match(db, /purchaseOrigin/);
  assert.match(db, /labelProvider/);
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
  assert.match(server, /Label purchase dimensions/);
  assert.match(server, /Carrier-reported dimensions/);
  assert.match(server, /\["label_origin", "Purchased through", \(row\) => shippingReportPurchaseWorkflow\(row\)\]/);
  assert.match(server, /\["provider", "Label provider", \(row\) => shippingReportLabelProvider\(row\)\]/);
  assert.match(server, /\["label_source", "Technical source code"/);
  assert.match(server, /function shippingReportPurchaseWorkflow[\s\S]*purchase_origin[\s\S]*return "DataPlus"/);
  assert.doesNotMatch(server, /function shippingReportPurchaseWorkflow[\s\S]{0,900}batch_id/);
  assert.match(server, /function shippingReportPurchaseWorkflow[\s\S]*return "Outside DataPlus"/);
  assert.match(server, /\["package_measurement_source", "Package dimensions source"/);
  assert.match(server, /const externalSources = \["ebay", "temu", "walmart", "shopify", "outsourced"/);
  assert.match(server, /SHIPPING_REPORT_PREFERENCE_VERSION = 3/);
  assert.match(server, /migrateShippingReportPreferences/);
  assert.match(server, /shipping\/preferences/);
  assert.match(server, /includeProfitability: url\.searchParams\.get\("includeProfitability"\) !== "false"/);
  assert.match(server, /readUserTablePreference\(reportPreferenceUserId/);
});

test("shipping label provenance separates purchase workflow from provider", () => {
  const { shippingReportPurchaseWorkflow, shippingReportLabelProvider } = require("../server");
  const temuPurchasedInsideDataPlus = { purchase_origin: "dataplus", batch_id: "batch-123", print_job_id: "print-123", label_source: "temu", provider: "temu" };
  assert.equal(shippingReportPurchaseWorkflow(temuPurchasedInsideDataPlus), "DataPlus");
  assert.equal(shippingReportLabelProvider(temuPurchasedInsideDataPlus), "Temu");

  const temuImportedThenPrinted = { batch_id: "batch-456", print_job_id: "print-456", label_source: "temu", provider: "temu" };
  assert.equal(shippingReportPurchaseWorkflow(temuImportedThenPrinted), "Outside DataPlus");

  const ebayImported = { label_source: "ebay", provider: "ebay" };
  assert.equal(shippingReportPurchaseWorkflow(ebayImported), "Outside DataPlus");
  assert.equal(shippingReportLabelProvider(ebayImported), "eBay");

  const walmartImportedWithoutRawSource = { provider: "walmart" };
  assert.equal(shippingReportPurchaseWorkflow(walmartImportedWithoutRawSource), "Outside DataPlus");
  assert.equal(shippingReportLabelProvider(walmartImportedWithoutRawSource), "Walmart");

  const legacyUnknown = { label_source: "legacy_unknown", provider: "dataplus" };
  assert.equal(shippingReportPurchaseWorkflow(legacyUnknown), "Unknown");
  assert.equal(shippingReportLabelProvider(legacyUnknown), "Unknown");
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
      return { total: 1, rows: [{ display_order_number: `ORDER-${options.from}`, net_purchased_label_cost: 1.25 }] };
    };
    postgres.readOperationJob = async () => job;
    postgres.upsertOperationArtifact = async () => {};
    postgres.upsertOperationJob = async () => {};

    const first = await runShippingReportExportWorkerJob(job);
    artifactDir = path.dirname(first.originalFilePath);
    const firstCsv = fs.readFileSync(first.originalFilePath, "utf8").trim().split(/\r?\n/);
    assert.equal(calls.length, 4);
    assert.equal(firstCsv.length, 5);
    assert.equal(firstCsv[0], "Order number,Net label purchase cost");
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
  assert.match(component, /Purchased through/);
  assert.match(component, /Matched purchase cost/);
  assert.match(component, /Carrier \/ channel billed/);
  assert.match(component, /Billing difference/);
  assert.match(ledger, /Original label purchase cost/);
  assert.match(ledger, /Awaiting settlement/);
  assert.match(component, /Label provider/);
  assert.match(component, /params\.set\("purchaseOrigin"/);
  assert.match(component, /params\.set\("labelProvider"/);
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
  assert.match(charts, /Label purchases versus carrier bills/);
  assert.match(charts, /Package measurement quality/);
  assert.match(component, /shipments are awaiting a final carrier or channel bill/);
  assert.match(ledger, /Displayed columns/);
  assert.match(ledger, /Saved template/);
  assert.match(ledger, /Purchase DIM weight \(139\)/);
  assert.match(ledger, /Label purchase measurements/);
  assert.match(ledger, /Carrier-reported measurements/);
  assert.match(ledger, /id: "label_origin", label: "Purchased through"/);
  assert.match(ledger, /id: "provider", label: "Label provider"/);
  assert.match(ledger, /id: "label_source", label: "Technical source code", group: "Operations and audit"/);
  assert.match(ledger, /function labelPurchaseWorkflow[\s\S]*purchase_origin[\s\S]*return "DataPlus"/);
  assert.doesNotMatch(ledger, /function labelPurchaseWorkflow[\s\S]{0,900}batch_id/);
  assert.match(ledger, /id: "package_measurement_source", label: "Package dims source"/);
  assert.match(ledger, /migrated\[index\] === "label_source"/);
  assert.match(ledger, /SHIPPING_REPORT_PREFERENCE_VERSION = 3/);
  assert.doesNotMatch(ledger, /id: "package_length", label: "Entered length"/);
  assert.doesNotMatch(ledger, /id: "carrier_billed_length", label: "Carrier billed length"/);
  assert.match(ledger, /Export shipping audit/);
});

test("shipping product allocation and accounting rules are documented", () => {
  assert.match(db, /when order_product_sales > 0 then product_sales \/ order_product_sales/);
  assert.match(db, /when order_qty > 0 then qty \/ order_qty/);
  assert.match(docs, /Customer-paid shipping is revenue/);
  assert.match(docs, /Original label purchase cost is the amount charged or recorded/);
  assert.match(docs, /Final carrier or channel billing is stored separately/);
  assert.match(docs, /Voided labels are excluded by default/);
  assert.match(docs, /historical package fallback/i);
  assert.match(docs, /same order and normalized tracking number/i);
  assert.match(docs, /rate-request package snapshot/i);
  assert.match(docs, /Label purchase measurements/);
  assert.match(docs, /Carrier-reported measurements/);
  assert.match(docs, /Package dims source/);
  assert.match(docs, /Purchased through/);
  assert.match(docs, /Outside DataPlus/);
  assert.match(docs, /Label provider/);
  assert.match(docs, /Technical source code/);
  assert.match(docs, /Historical - unknown/);
  assert.match(docs, /not treated as final billed cost without invoice or settlement evidence/);
});

