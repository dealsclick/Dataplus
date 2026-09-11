const assert = require('node:assert/strict');
const url = process.env.DATAPLUS_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw Error('Use an isolated local database ending in _test.');
process.env.DATABASE_URL = url;
const db = require('../db');
async function main() {
  await db.initRelationalSchema();
  await db.upsertVendorCatalogItemsFromProducts('fixture', [
    { sku: 'DH-A', supplierCode: 'DH', active: true, title: 'Active source', barcode: '123', sourceCost: 2 },
    { sku: 'DH-B', supplierCode: 'DH', active: false, title: 'Inactive source' },
    { sku: 'OTHER', supplierCode: 'OTHER', active: true }
  ], { leanRaw: true, syncMode: 'catalog', skipSnapshots: true });
  const summary = await db.storedVendorCatalogSummary(['dh']);
  assert.equal(summary.total, 2);
  assert.equal(summary.unknownstatus, 0);
  const rows = await db.storedVendorCatalogBatch(['dh']);
  assert.deepEqual(rows.map(row => row.product.sku), ['DH-A', 'DH-B']);
  assert.equal(rows[0].product.active, true);
  assert.equal(rows[1].product.active, false);
  assert.equal((await db.storedVendorCatalogBatch(['dh'], rows[0].cursor)).length, 1);
  assert.equal((await db.storedVendorCatalogBatch(['dh'], rows[1].cursor)).length, 0);
  await db.getPool().query("update vendor_catalog_items set raw=raw-'active' where vendor_id='dh' and source_sku='DH-B'");
  assert.equal((await db.storedVendorCatalogSummary(['dh'])).unknownstatus, 1);
  assert.equal((await db.storedVendorCatalogBatch(['dh']))[1].product.active, null);
  console.log('Stored source SQL: supplier scope, cursor, retained active flags and unknown historical status passed.');
}
main().catch(error => { console.error(error.message); process.exitCode=1; }).finally(()=>db.closePool());
