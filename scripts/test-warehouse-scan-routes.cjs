const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

async function run(route, { product = null, closed = false } = {}) {
  const marker = `parts[1] === "warehouse-audits" && parts[2] && parts[3] === "${route}"`;
  const location = source.indexOf(marker);
  assert.ok(location > 0);
  const start = source.lastIndexOf('  if (', location);
  const end = source.indexOf('\n  if (', location);
  const audit = { id: 'audit', auditNumber: 'AUDIT-TEST', status: closed ? 'completed' : 'in_progress', warehouseId: 'physical', lines: [], unknownBarcodes: [] };
  let warehouseReads = 0;
  let written;
  let created;
  const body = { barcode: 'X0039W0Z71', locationBin: 'A-01', quantity: 2, qty: 2, sku: 'TEST-SKU', title: 'Test item', user: 'Test counter' };
  const context = {
    req: { method: 'POST' }, res: {}, parts: ['api', 'warehouse-audits', 'audit', route],
    parseBody: async () => body,
    readDbFast: () => { throw Error('Scanner must not load global inventory summaries'); },
    resolveScannedCatalogBarcode: async () => ({ product, sourceItem: null }),
    validateWarehouseBin: (_warehouse, bin) => ({ value: bin }),
    auditProductImageUrl: () => '', auditExpectedQuantity: () => 3,
    normalizeWarehouseStockRow: row => row,
    crypto: { randomUUID: () => 'created-id' },
    redisCache: { deleteByPrefix: async () => {} },
    notFound: () => ({ status: 404 }), sendJson: (_res, status, data) => ({ status, data }),
    postgres: {
      isPostgresEnabled: () => true,
      readStateField: async key => { assert.equal(key, 'warehouseAudits'); return [audit]; },
      readStateFields: async keys => { assert.deepEqual(Array.from(keys), ['warehouses']); warehouseReads++; return { warehouses: [{ id: 'physical', name: 'Physical', isPhysical: true }] }; },
      readVendorCatalogSupplierCoverageBySkus: async () => [],
      readProductByKey: async () => null,
      upsertProductsFromState: async rows => { created = rows[0]; },
      upsertInventoryLevelsFromProducts: async rows => { assert.equal(rows[0], created); },
      writeStateDocuments: async state => { written = state; },
    },
  };
  const result = await vm.runInNewContext(`(async () => { ${source.slice(start, end)} })()`, context);
  return { result, audit, warehouseReads, written, created };
}

(async () => {
  const unknown = await run('scan');
  assert.equal(unknown.result.status, 200);
  assert.equal(unknown.result.data.matched, false);
  assert.equal(unknown.warehouseReads, 1);
  assert.equal(unknown.written.warehouseAudits[0].unknownBarcodes[0].count, 2);
  assert.equal(unknown.audit.unknownBarcodes[0].locationBin, 'A-01');
  const matched = await run('scan', { product: { id: 'product', sku: 'EXISTING', title: 'Existing product' } });
  assert.equal(matched.result.data.matched, true);
  assert.equal(matched.audit.lines[0].countedQty, 2);
  assert.equal(matched.audit.lines[0].expectedQty, 3);
  const manual = await run('manual-item');
  assert.equal(manual.result.status, 201);
  assert.equal(manual.created.status, 'Draft');
  assert.equal(manual.created.createdAuditId, 'audit');
  assert.equal(manual.created.warehouseStock[0].locationBin, 'A-01');
  assert.equal(manual.created.warehouseStock[0].qty, 2);
  for (const route of ['scan', 'manual-item']) {
    const closed = await run(route, { closed: true });
    assert.equal(closed.result.status, 400);
    assert.equal(closed.warehouseReads, 0);
    assert.equal(closed.written, undefined);
  }
  console.log('Audit scan/create routes retain counts, bins, provenance, and closed-audit guards without global inventory reads.');
})().catch(error => { console.error(error); process.exitCode = 1; });
