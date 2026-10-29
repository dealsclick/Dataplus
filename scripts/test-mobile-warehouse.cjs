const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('server.js', 'utf8');
const mobileSource = fs.readFileSync('web/src/components/warehouse-mobile.tsx', 'utf8');
const warehouseRouteSource = fs.readFileSync('web/src/components/warehouse-route.tsx', 'utf8');
const appSource = fs.readFileSync('web/src/App.tsx', 'utf8');
assert.match(mobileSource, /section === "receiving"[\s\S]*: receiving\)}/, 'Mobile Receive POs must render the inbound receiving launcher');
assert.doesNotMatch(mobileSource, /function PurchaseQueue/, 'The obsolete search-only mobile PO landing must stay removed');
assert.match(warehouseRouteSource, /receiving=\{canReceive \? <InboundReceivingLauncher mobile/, 'Mobile receiving must use the existing/manual PO launcher');
assert.match(warehouseRouteSource, /manual=\{canReceive \? <ManualReceivingPanel mobile/, 'Other stock must remain the ordinary manual receipt flow');
assert.match(warehouseRouteSource, /const beginQuickCreate = \(draft\?[\s\S]*quickCreatePhotoInputRef\.current\?\.click\(\)/, 'Warehouse quick create must open the product camera directly');
assert.match(warehouseRouteSource, /<DialogTitle>Quick create product<\/DialogTitle>[\s\S]*\{manualPhotoUrls\.length\}\/8 photos[\s\S]*Take another[\s\S]*Create draft SKU/, 'Warehouse quick create must support a compact multi-photo capture flow');
assert.match(warehouseRouteSource, /if \(resumeScanner\) setCameraOpen\(true\)/, 'Camera quick create must return the worker to barcode scanning');
assert.match(appSource, /href="\/warehouse\/mobile"[\s\S]*Warehouse Mobile/, 'The mobile account menu must link to Warehouse Mobile');
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
