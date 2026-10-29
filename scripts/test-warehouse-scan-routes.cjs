const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

async function run(route, { product = null, closed = false, unknowns = [], lines = [], originalBin, omitSku = false } = {}) {
  const marker = `parts[1] === "warehouse-audits" && parts[2] && parts[3] === "${route}"`;
  const location = source.indexOf(marker);
  assert.ok(location > 0);
  const start = source.lastIndexOf('  if (', location);
  const end = source.indexOf('\n  if (', location);
  const audit = { id: 'audit', auditNumber: 'AUDIT-TEST', status: closed ? 'completed' : 'in_progress', warehouseId: 'physical', lines, unknownBarcodes: unknowns };
  let warehouseReads = 0;
  let written;
  let created;
  let atomicLineWrites = 0;
  let savedMediaCount = 0;
  const photoDataUrls = ['photo-1', 'photo-2'].map(value => `data:image/jpeg;base64,${Buffer.from(value).toString('base64')}`);
  const body = { barcode: 'X0039W0Z71', locationBin: 'A-01', quantity: 2, qty: 2, sku: 'TEST-SKU', title: 'Test item', user: 'Test counter', clientActionId: 'quick-action-1', photoDataUrl: photoDataUrls[0], photoDataUrls };
  if (omitSku) delete body.sku;
  if (originalBin !== undefined) body.unknownLocationBin = originalBin;
  const context = {
    req: { method: 'POST' }, res: {}, parts: ['api', 'warehouse-audits', 'audit', route],
    parseBody: async () => body,
    readDbFast: () => { throw Error('Scanner must not load global inventory summaries'); },
    resolveScannedCatalogBarcode: async () => ({ product, sourceItem: null }),
    validateWarehouseBin: (_warehouse, bin) => ({ value: bin }),
    auditProductImageUrl: () => '', auditExpectedQuantity: () => 3,
    normalizeWarehouseStockRow: row => row,
    authUser: { name: 'Test counter' }, Buffer,
    crypto: { randomUUID: (() => { let value = 0; return () => `created-id-${++value}`; })() },
    redisCache: { deleteByPrefix: async () => {} },
    notFound: () => ({ status: 404 }), sendJson: (_res, status, data) => ({ status, data }),
    postgres: {
      isPostgresEnabled: () => true,
      readWarehouseAudit: async () => audit,
      saveWarehouseAudit: async next => { written = { warehouseAudits: [next] }; return next; },
      saveWarehouseAuditMetadata: async next => { written = { auditMetadata: { ...next, lines: undefined } }; return true; },
      applyWarehouseAuditScan: async (_auditId, input) => {
        atomicLineWrites++;
        const current = lines.find(line => String(line.productId || line.sku) === String(input.productId || input.sku) && String(line.locationBin || '').toLowerCase() === String(input.locationBin || '').toLowerCase());
        return { ...current, ...input.line, id: current?.id || input.line.id, countedQty: Number(current?.countedQty || 0) + Number(input.quantity || 0) };
      },
      recordWarehouseAuditUnknownScan: async (_auditId, input) => {
        const next = unknowns.map(entry => ({ ...entry }));
        const current = next.find(entry => entry.barcode === input.barcode && String(entry.locationBin || '').toLowerCase() === String(input.locationBin || '').toLowerCase());
        if (current) current.count = Number(current.count || 0) + Number(input.quantity || 0);
        else next.push({ barcode: input.barcode, count: input.quantity, locationBin: input.locationBin, scannedAt: input.scannedAt, sourceMatch: input.sourceMatch });
        written = { unknownBarcodes: next };
        return { unknownBarcodes: next };
      },
      saveWarehouseAuditLine: async (_auditId, line, options) => {
        atomicLineWrites++;
        savedMediaCount = options.photoDataUrls.length;
        return { ...line };
      },
      readStateField: async key => { assert.equal(key, 'warehouseAudits'); return [audit]; },
      readStateFields: async keys => { assert.deepEqual(Array.from(keys), ['warehouses']); warehouseReads++; return { warehouses: [{ id: 'physical', name: 'Physical', isPhysical: true }] }; },
      readVendorCatalogSupplierCoverageBySkus: async () => [],
      readProductByKey: async () => null,
      nextWarehouseSkuAtomic: async () => 'DPS10001',
      upsertProductsFromState: async rows => { created = rows[0]; },
      upsertInventoryLevelsFromProducts: async rows => { assert.equal(rows[0], created); },
      writeStateDocuments: async state => { written = state; },
    },
  };
  const result = await vm.runInNewContext(`(async () => { ${source.slice(start, end)} })()`, context);
  return { result, audit, warehouseReads, written, created, atomicLineWrites, savedMediaCount };
}

(async () => {
  const generated = await run('next-sku');
  assert.equal(generated.result.status, 200);
  assert.equal(generated.result.data.sku, 'DPS10001');
  const unknown = await run('scan');
  assert.equal(unknown.result.status, 200);
  assert.equal(unknown.result.data.matched, false);
  assert.equal(unknown.warehouseReads, 1);
  assert.equal(unknown.written.unknownBarcodes[0].count, 2);
  assert.equal(unknown.audit.unknownBarcodes[0].locationBin, 'A-01');
  const matched = await run('scan', { product: { id: 'product', sku: 'EXISTING', title: 'Existing product' } });
  assert.equal(matched.result.data.matched, true);
  assert.equal(matched.audit.lines[0].countedQty, 2);
  assert.equal(matched.audit.lines[0].expectedQty, 3);
  assert.equal(matched.atomicLineWrites, 1);
  const manual = await run('manual-item');
  assert.equal(manual.result.status, 201);
  assert.equal(manual.created.status, 'Draft');
  assert.equal(manual.created.createdAuditId, 'audit');
  assert.equal(manual.created.warehouseStock[0].locationBin, 'A-01');
  assert.equal(manual.created.warehouseStock[0].qty, 2);
  assert.equal(manual.audit.unknownBarcodes.length, 0);
  assert.equal(manual.audit.lines[0].sku, 'TEST-SKU');
  assert.equal(manual.audit.lines[0].countedQty, 2);
  const generatedManual = await run('manual-item', { omitSku: true });
  assert.equal(generatedManual.result.status, 201);
  assert.equal(generatedManual.created.sku, 'DPS10001');
  assert.equal(generatedManual.audit.lines[0].sku, 'DPS10001');
  const quick = await run('quick-item');
  assert.equal(quick.result.status, 201);
  assert.equal(quick.created.sku, 'DPS10001');
  assert.equal(quick.created.status, 'Draft');
  assert.equal(quick.created.needsProductDetails, true);
  assert.deepEqual(Array.from(quick.created.tags), ['warehouse-quick-create', 'needs-product-details']);
  assert.match(quick.created.defaultImage, /^\/api\/warehouse-audits\/audit\/lines\//);
  assert.equal(quick.created.images.length, 2);
  assert.equal(quick.created.quickCreate.photoCount, 2);
  assert.equal(quick.savedMediaCount, 2);
  assert.equal(quick.audit.lines[0].quickCreated, true);
  assert.equal(quick.audit.lines[0].reviewStatus, 'needs_details');
  assert.equal(quick.audit.lines[0].countedQty, 2);
  const duplicateQuick = await run('quick-item', { lines: [{ id: 'line-1', productId: 'quick-product', sku: 'DPS10001', quickCreateClientId: 'quick-action-1', countedQty: 2 }] });
  assert.equal(duplicateQuick.result.status, 200);
  assert.equal(duplicateQuick.result.data.duplicate, true);
  assert.equal(duplicateQuick.audit.lines[0].countedQty, 2);
  const racedQuick = await run('quick-item', { product: { id: 'existing', sku: 'EXISTING', barcode: 'X0039W0Z71' } });
  assert.equal(racedQuick.result.status, 409);
  assert.equal(racedQuick.created, undefined);
  const resumed = await run('manual-item', { originalBin: 'B-02', unknowns: [{ barcode: 'X0039W0Z71', locationBin: 'A-01', count: 5 }, { barcode: 'X0039W0Z71', locationBin: 'B-02', count: 2 }] });
  assert.equal(resumed.audit.unknownBarcodes[0].createdProductSku, undefined);
  assert.equal(resumed.audit.unknownBarcodes[0].count, 5);
  assert.equal(resumed.audit.unknownBarcodes.length, 1);
  assert.equal(resumed.audit.lines[0].sku, 'TEST-SKU');
  assert.equal(resumed.audit.lines[0].locationBin, 'A-01');
  for (const route of ['next-sku', 'scan', 'quick-item', 'manual-item']) {
    const closed = await run(route, { closed: true });
    assert.equal(closed.result.status, 400);
    assert.equal(closed.warehouseReads, 0);
    assert.equal(closed.written, undefined);
  }
  console.log('Audit scan/create routes retain counts, bins, provenance, and closed-audit guards without global inventory reads.');
})().catch(error => { console.error(error); process.exitCode = 1; });
