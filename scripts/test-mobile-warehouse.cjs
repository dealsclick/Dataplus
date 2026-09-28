const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('server.js', 'utf8');
const start = source.indexOf('async function purchaseOrderWithCatalogImages(');
const end = source.indexOf('\nasync function ', start + 1);
assert.ok(start > 0 && end > start);
const fn = vm.runInNewContext(`(${source.slice(start, end)})`, {
  postgres: { isPostgresEnabled: () => true, readProductsByKeys: async () => [{sku:'SKU-1',upc:'001234567890',barcode:'001234567890',vendorSku:'V-1'}] },
  findCatalogProductsBySkus: async () => [{sku:'SKU-1',upc:'UNAPPROVED-SOURCE-ID',image:'source.jpg'}],
  compactCatalogImageUrl: product => product.image || '',
});
(async () => {
  const po = {id:'po',items:[{sku:'SKU-1',routeId:'route-1',qty:7,receivedQty:2},{sku:'UNMANAGED',qty:1}]};
  const before = JSON.stringify(po);
  const result = await fn(po);
  assert.deepEqual(Array.from(result.items[0].scanIdentifiers), ['SKU-1','001234567890','V-1']);
  assert.equal(result.items[0].defaultImage,'source.jpg');
  assert.equal(result.items[0].routeId,'route-1');
  assert.equal(result.items[0].receivedQty,2);
  assert.equal(result.items[1].scanIdentifiers.length,0);
  assert.equal(JSON.stringify(po),before,'Projection must not mutate stored PO quantities or identity');
  assert.deepEqual(Array.from((await fn({lines:po.items})).lines[0].scanIdentifiers), ['SKU-1','001234567890','V-1']);
  console.log('Mobile warehouse scanner identity projection passed.');
})().catch(error => { console.error(error); process.exitCode=1; });
