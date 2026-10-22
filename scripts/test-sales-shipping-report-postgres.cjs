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
    await pool.query("delete from order_shipment_financials where order_id like 'shipping-report-test-%'");
    await pool.query("delete from order_records where order_id like 'shipping-report-test-%'");
    await pool.query(`
      insert into order_records (order_id, order_number, source, channel_source, status, total, paid_amount, order_date, raw)
      values
        ('shipping-report-test-snapshot', 'SR-SNAPSHOT', 'temu', 'temu', 'shipped', 20, 20, '2026-10-10', '{}'::jsonb),
        ('shipping-report-test-history', 'SR-HISTORY', 'ebay', 'ebay', 'shipped', 30, 30, '2026-10-11', '{"shipments":[{"id":"history-label","package":{"weight":7,"length":18,"width":12,"height":9}}]}'::jsonb),
        ('shipping-report-test-normalized', 'SR-NORMALIZED', 'walmart', 'walmart', 'shipped', 40, 40, '2026-10-12', '{}'::jsonb)
    `);
    await pool.query(`
      insert into order_shipment_financials (
        order_id, shipment_id, order_number, tracking_number, channel_source, estimated_shipping_cost,
        package_weight, package_length, package_width, package_height, purchased_at, raw
      ) values
        ('shipping-report-test-snapshot', 'snapshot-label', 'SR-SNAPSHOT', 'TRACK-SNAPSHOT', 'temu', 5, null, null, null, null, '2026-10-10', '{"packageDetails":{"weightPounds":4,"lengthInches":14,"widthInches":10,"heightInches":8}}'::jsonb),
        ('shipping-report-test-history', 'history-label', 'SR-HISTORY', 'TRACK-HISTORY', 'ebay', 6, null, null, null, null, '2026-10-11', '{}'::jsonb),
        ('shipping-report-test-normalized', 'normalized-label', 'SR-NORMALIZED', 'TRACK-NORMALIZED', 'walmart', 7, 2, 10, 8, 6, '2026-10-12', '{}'::jsonb)
    `);

    const report = await postgres.salesShippingReportingSummary({ from: "2026-10-01", to: "2026-10-31" });
    assert.equal(Number(report.summary.shipment_count), 3);
    assert.equal(Number(report.summary.package_coverage_count), 3);

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
    console.log("shipping report PostgreSQL package fallback: ok");
  } finally {
    await pool.end();
    await postgres.closePool();
  }
}

run().catch(async (error) => {
  console.error(error);
  await postgres.closePool().catch(() => {});
  process.exitCode = 1;
});
