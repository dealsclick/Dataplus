const assert = require("node:assert/strict");

const databaseUrl = process.env.SUPPLIER_COVERAGE_TEST_DATABASE_URL || process.env.DATAPLUS_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("SUPPLIER_COVERAGE_TEST_DATABASE_URL is required.");
const parsed = new URL(databaseUrl);
if (!parsed.pathname.endsWith("_test") || !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
  throw new Error("Use an isolated local PostgreSQL database ending in _test.");
}
process.env.DATABASE_URL = databaseUrl;

const db = require("../db");

async function main() {
  await db.initRelationalSchema();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sku = `IDENTITY-A-${suffix}`;
  const changedSku = `IDENTITY-B-${suffix}`;
  const vendor = `identity-vendor-${suffix}`;
  const emptyRun = `identifier-empty-${suffix}`;
  const fillRun = `identifier-fill-${suffix}`;
  const overwriteRun = `identifier-overwrite-attempt-${suffix}`;

  await db.upsertProductsFromState([{
    id: `product-${suffix}`,
    sku,
    title: "Identifier fill fixture",
    barcode: "0",
    mfrPartNumber: "KEEP-MPN",
    supplierCode: vendor,
    supplier: vendor,
    active: true
  }], { insertOnly: true });

  await db.upsertVendorCatalogItemsFromProducts(emptyRun, [{
    sku,
    supplierCode: vendor,
    supplier: vendor,
    barcode: "0",
    mfrPartNumber: "0",
    title: "Identifier fill fixture"
  }], { syncMode: "catalog", skipSnapshots: true, leanRaw: true });

  await db.upsertVendorCatalogItemsFromProducts(fillRun, [{
    sku,
    supplierCode: vendor,
    supplier: vendor,
    barcode: "012345678905",
    mfrPartNumber: "MFR-ORIGINAL",
    title: "Identifier fill fixture"
  }], { syncMode: "split", skipSnapshots: true, leanRaw: true });

  await db.upsertVendorCatalogItemsFromProducts(overwriteRun, [{
    sku,
    supplierCode: vendor,
    supplier: vendor,
    barcode: "999999999999",
    mfrPartNumber: "MFR-CHANGED",
    title: "Identifier fill fixture"
  }, {
    sku: changedSku,
    supplierCode: vendor,
    supplier: vendor,
    barcode: "111111111111",
    mfrPartNumber: "MFR-NEW-SKU",
    title: "Changed supplier SKU fixture"
  }], { syncMode: "split", skipSnapshots: true, leanRaw: true });

  const sourceRows = await db.getPool().query(`
    select source_sku, barcode, mfr_part_number
    from vendor_catalog_items
    where vendor_id = $1 and source_sku = any($2::text[])
    order by source_sku
  `, [vendor, [sku, changedSku]]);
  assert.equal(sourceRows.rowCount, 2, "a changed source SKU must create a separate supplier row");
  const original = sourceRows.rows.find((row) => row.source_sku === sku);
  assert.equal(original.barcode, "012345678905", "a populated UPC must not be overwritten");
  assert.equal(original.mfr_part_number, "MFR-ORIGINAL", "a populated MPN must not be overwritten");

  const fill = await db.fillMissingProductIdentifiersFromVendorCatalog(overwriteRun);
  assert.equal(fill.productsUpdated, 1);
  assert.equal(fill.upcsFilled, 1);
  assert.equal(fill.mpnsFilled, 0);

  const product = (await db.getPool().query(`
    select sku, barcode, mfr_part_number
    from products
    where sku = $1
  `, [sku])).rows[0];
  assert.equal(product.sku, sku, "identifier completion must never rename the managed SKU");
  assert.equal(product.barcode, "012345678905");
  assert.equal(product.mfr_part_number, "KEEP-MPN", "an existing managed MPN must remain authoritative");

  console.log("Product identifier fill-only PostgreSQL checks passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.closePool());
