const assert = require("node:assert/strict");
const { Pool } = require("pg");

const databaseUrl = String(process.env.DATABASE_URL || "");
if (!/_shipping_report_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error("DATABASE_URL must point to an isolated database ending in _shipping_report_test.");
}

const postgres = require("../db");

async function run() {
  await postgres.salesShippingReportingSummary({ from: "2026-10-01", to: "2026-10-31" });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("delete from shipping_report_facts where order_id like 'shipping-report-test-%'");
    await pool.query("delete from reporting_fact_dirty_orders where fact_name = 'shipping-report'");
    await pool.query("update reporting_fact_state set status='pending', source_cursor=null, rows_written=0, last_error=null where fact_name='shipping-report'");
    await pool.query("delete from order_shipment_financials where order_id like 'shipping-report-test-%'");
    await pool.query("delete from order_records where order_id like 'shipping-report-test-%'");
    await pool.query(`
      insert into order_records (order_id, order_number, source, channel_source, status, total, paid_amount, order_date, raw)
      values
        ('shipping-report-test-snapshot', 'SR-SNAPSHOT', 'temu', 'temu', 'shipped', 20, 20, '2026-10-10', '{}'::jsonb),
        ('shipping-report-test-history', 'SR-HISTORY', 'ebay', 'ebay', 'shipped', 30, 30, '2026-10-11', '{"shipments":[{"id":"history-label","package":{"weight":7,"length":18,"width":12,"height":9}}]}'::jsonb),
        ('shipping-report-test-normalized', 'SR-NORMALIZED', 'walmart', 'walmart', 'shipped', 40, 40, '2026-10-12', '{}'::jsonb),
        ('shipping-report-test-missing', 'SR-MISSING', 'shopify', 'shopify', 'shipped', 50, 50, '2026-10-13', '{}'::jsonb)
    `);
    await pool.query(`
      insert into order_shipment_financials (
        order_id, shipment_id, order_number, tracking_number, channel_source, estimated_shipping_cost,
        package_weight, package_length, package_width, package_height, purchased_at, raw
      ) values
        ('shipping-report-test-snapshot', 'snapshot-label', 'SR-SNAPSHOT', 'TRACK-SNAPSHOT', 'temu', 5, null, null, null, null, '2026-10-10', '{"packageDetails":{"weightPounds":4,"lengthInches":14,"widthInches":10,"heightInches":8}}'::jsonb),
        ('shipping-report-test-history', 'history-label', 'SR-HISTORY', 'TRACK-HISTORY', 'ebay', 6, null, null, null, null, '2026-10-11', '{}'::jsonb),
        ('shipping-report-test-normalized', 'normalized-label', 'SR-NORMALIZED', 'TRACK-NORMALIZED', 'walmart', 7, 2, 10, 8, 6, '2026-10-12', '{}'::jsonb),
        ('shipping-report-test-missing', 'missing-label', 'SR-MISSING', 'TRACK-MISSING', 'shopify', 8, null, null, null, null, '2026-10-13', '{}'::jsonb)
    `);

    const report = await postgres.salesShippingReportingSummary({ from: "2026-10-01", to: "2026-10-31" });
    assert.equal(report.factSource, "live_projection");
    assert.equal(Number(report.summary.shipment_count), 4);
    assert.equal(Number(report.summary.package_coverage_count), 2, "the summary stays bounded and does not scan deep legacy shipment JSON");

    const coreReport = await postgres.salesShippingReportingSummary({ from: "2026-10-01", to: "2026-10-31", includeProfitability: false });
    assert.equal(Number(coreReport.summary.shipment_count), 3);
    assert.deepEqual(coreReport.categories, []);
    assert.deepEqual(coreReport.suppliers, []);
    assert.deepEqual(coreReport.products, []);

    const ledger = await postgres.salesShippingReportingShipments({ from: "2026-10-01", to: "2026-10-31", pageSize: 10 });
    const byOrder = new Map(ledger.rows.map((row) => [row.order_number, row]));
    assert.deepEqual(
      [byOrder.get("SR-SNAPSHOT").package_weight, byOrder.get("SR-SNAPSHOT").package_length, byOrder.get("SR-SNAPSHOT").package_width, byOrder.get("SR-SNAPSHOT").package_height],
      [4, 14, 10, 8]
    );
    assert.deepEqual(
      [byOrder.get("SR-HISTORY").package_weight, byOrder.get("SR-HISTORY").package_length, byOrder.get("SR-HISTORY").package_width, byOrder.get("SR-HISTORY").package_height],
      [7, 18, 12, 9]
    );
    assert.deepEqual(
      [byOrder.get("SR-NORMALIZED").package_weight, byOrder.get("SR-NORMALIZED").package_length, byOrder.get("SR-NORMALIZED").package_width, byOrder.get("SR-NORMALIZED").package_height],
      [2, 10, 8, 6]
    );
    assert.equal(byOrder.get("SR-SNAPSHOT").package_measurement_source, "channel_import");
    assert.equal(byOrder.get("SR-HISTORY").package_measurement_source, "channel_import");
    assert.equal(byOrder.get("SR-NORMALIZED").package_measurement_source, "channel_import");

    const rebuilt = await postgres.refreshShippingReportingFactsBatch({ rebuild: true, reset: true, limit: 10 });
    assert.equal(rebuilt.complete, true);
    assert.equal(rebuilt.processedOrders, 4);
    const factsStatus = await postgres.shippingReportingFactsStatus();
    assert.equal(factsStatus.ready, true);
    assert.equal(factsStatus.factRows, 4);

    const factReport = await postgres.salesShippingReportingSummary({ from: "2026-10-01", to: "2026-10-31" });
    assert.equal(factReport.factSource, "shipping_report_facts");
    assert.equal(Number(factReport.summary.shipment_count), Number(report.summary.shipment_count));
    assert.equal(Number(factReport.summary.estimated_shipping_cost), Number(report.summary.estimated_shipping_cost));
    const factLedger = await postgres.salesShippingReportingShipments({ from: "2026-10-01", to: "2026-10-31", pageSize: 10 });
    assert.equal(factLedger.factSource, "shipping_report_facts");
    assert.equal(factLedger.total, ledger.total);

    await pool.query("update order_shipment_financials set estimated_shipping_cost=8 where order_id='shipping-report-test-snapshot'");
    const dirtyStatus = await postgres.shippingReportingFactsStatus();
    assert.equal(dirtyStatus.dirtyOrders, 1);
    const refreshed = await postgres.refreshShippingReportingFactsBatch({ limit: 10 });
    assert.equal(refreshed.processedOrders, 1);
    const refreshedLedger = await postgres.salesShippingReportingShipments({ from: "2026-10-01", to: "2026-10-31", pageSize: 10 });
    assert.equal(refreshedLedger.rows.find((row) => row.order_number === "SR-SNAPSHOT").estimated_shipping_cost, 8);
    assert.equal((await postgres.shippingReportingFactsStatus()).dirtyOrders, 0);
    console.log("shipping report PostgreSQL package fallback and incremental facts: ok");
  } finally {
    await pool.query("delete from shipping_report_facts where order_id like 'shipping-report-test-%'").catch(() => {});
    await pool.query("delete from reporting_fact_dirty_orders where order_id like 'shipping-report-test-%'").catch(() => {});
    await pool.query("delete from order_shipment_financials where order_id like 'shipping-report-test-%'").catch(() => {});
    await pool.query("delete from order_records where order_id like 'shipping-report-test-%'").catch(() => {});
    await pool.end();
    await postgres.closePool();
  }
}

run().catch(async (error) => {
  console.error(error);
  await postgres.closePool().catch(() => {});
  process.exitCode = 1;
});
