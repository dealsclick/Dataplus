const assert = require("assert");

const databaseUrl = String(process.env.SUPPLIER_COVERAGE_TEST_DATABASE_URL || "").trim();
if (!databaseUrl) {
  console.log("supplier coverage resume test skipped (set SUPPLIER_COVERAGE_TEST_DATABASE_URL)");
  process.exit(0);
}

const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (!databaseName.endsWith("_supplier_test")) {
  throw new Error("SUPPLIER_COVERAGE_TEST_DATABASE_URL must point to an isolated database ending in _supplier_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.DATAPLUS_DOCKER = "0";
process.env.SUPPLIER_COVERAGE_BATCH_SIZE = "500";
process.env.SUPPLIER_COVERAGE_KEY_BATCH_SIZE = "250";
process.env.SUPPLIER_COVERAGE_BATCH_TIMEOUT_MS = "120000";

const postgres = require("../db");

async function run() {
  await postgres.initDatabase();
  const pool = postgres.getPool();
  await pool.query(`
    truncate table
      supplier_match_reviews,
      product_supplier_links,
      vendor_supplier_coverage,
      supplier_coverage_vendor_identity_stage,
      supplier_coverage_vendor_mpn_stage,
      supplier_coverage_product_mpn_stage,
      supplier_coverage_key_stage,
      supplier_coverage_link_stage,
      supplier_coverage_rebuild_state,
      vendor_catalog_items,
      products,
      vendors
    cascade
  `);
  await pool.query(`
    insert into vendors (vendor_id, code, name)
    values ('vendor-a', 'A', 'Vendor A'), ('vendor-b', 'B', 'Vendor B')
  `);
  await pool.query(`
    insert into products (
      product_id, sku, title, mfr_part_number, barcode, raw, created_at, updated_at
    )
    select
      'product-' || lpad(n::text, 4, '0'),
      'SKU-' || lpad(n::text, 4, '0'),
      'Test product ' || n,
      'MPN-' || lpad(n::text, 4, '0'),
      lpad(n::text, 12, '0'),
      '{}'::jsonb,
      now(), now()
    from generate_series(1, 520) n
  `);
  await pool.query(`
    insert into vendor_catalog_items (
      vendor_id, source_sku, internal_sku, vendor_sku, title, mfr_part_number,
      barcode, raw, created_at, updated_at
    )
    select
      vendor.vendor_id,
      upper(vendor.code) || '-SOURCE-' || lpad(n::text, 4, '0'),
      null,
      'SKU-' || lpad(n::text, 4, '0'),
      vendor.name || ' test product ' || n,
      'MPN-' || lpad(n::text, 4, '0'),
      lpad(n::text, 12, '0'),
      '{}'::jsonb,
      now(), now()
    from generate_series(1, 520) n
    cross join (values ('vendor-a', 'A', 'Vendor A'), ('vendor-b', 'B', 'Vendor B')) vendor(vendor_id, code, name)
  `);
  await pool.query("analyze products");
  await pool.query("analyze vendor_catalog_items");

  let cancel = false;
  await assert.rejects(
    postgres.refreshVendorSupplierCoverage({
      runId: "resume-test-generation",
      isCanceled: () => cancel,
      onProgress: (progress) => {
        if (progress.phase === "supplier_identities" && Number(progress.processedRows || 0) >= 500) cancel = true;
      }
    }),
    /canceled/i
  );

  const interrupted = await pool.query("select * from supplier_coverage_rebuild_state where state_key = 'active'");
  assert.equal(interrupted.rows[0]?.status, "stopped", "canceled rebuild records a resumable stopped state");
  assert.equal(interrupted.rows[0]?.phase, "vendor_identities", "rebuild remains at the interrupted phase");
  assert.ok(interrupted.rows[0]?.last_vendor_id, "the committed vendor cursor is retained");
  const staged = await pool.query("select count(*)::int as total from supplier_coverage_vendor_identity_stage");
  assert.ok(staged.rows[0].total >= 500, "the first durable identity batch survives cancellation");

  const result = await postgres.refreshVendorSupplierCoverage({
    runId: "resume-test-generation",
    isCanceled: () => false
  });
  assert.equal(result.enabled, true);
  const completed = await pool.query("select * from supplier_coverage_rebuild_state where state_key = 'active'");
  assert.equal(completed.rows[0]?.status, "complete", "the resumed rebuild completes");
  assert.equal(completed.rows[0]?.phase, "complete", "the final phase is durable");

  const coverage = await pool.query(`
    select supplier_count, has_multiple_suppliers, supplier_coverage_match_type
    from products
    where product_id = 'product-0001'
  `);
  assert.equal(Number(coverage.rows[0]?.supplier_count || 0), 2, "both suppliers are linked to the shared product identity");
  assert.equal(coverage.rows[0]?.has_multiple_suppliers, true);
  assert.equal(coverage.rows[0]?.supplier_coverage_match_type, "upc");

  const links = await pool.query(`
    select count(distinct vendor_id)::int as suppliers
    from product_supplier_links
    where product_id = 'product-0001'
  `);
  assert.equal(links.rows[0]?.suppliers, 2, "the durable staging set is published to live supplier links");

  const repeated = await postgres.refreshVendorSupplierCoverage({ runId: "resume-test-generation" });
  assert.equal(repeated.alreadyComplete, true, "replaying a completed generation is idempotent");
  console.log("supplier coverage resume checks passed");
}

run()
  .finally(() => postgres.closePool())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
