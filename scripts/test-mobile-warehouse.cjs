const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('server.js', 'utf8');
const mobileSource = fs.readFileSync('web/src/components/warehouse-mobile.tsx', 'utf8');
const warehouseRouteSource = fs.readFileSync('web/src/components/warehouse-route.tsx', 'utf8');
const returnReceivingSource = fs.readFileSync('web/src/components/return-receiving.tsx', 'utf8');
const appSource = fs.readFileSync('web/src/App.tsx', 'utf8');
assert.match(mobileSource, /section === "receiving"[\s\S]*: receiving\)}/, 'Mobile Receive POs must render the inbound receiving launcher');
assert.doesNotMatch(mobileSource, /function PurchaseQueue/, 'The obsolete search-only mobile PO landing must stay removed');
assert.match(mobileSource, /id: "returns", label: "Returns"/, 'Returns must be a primary warehouse mobile navigation item');
assert.doesNotMatch(mobileSource, /id: "manual", label: "Other stock"/, 'Other stock must not occupy primary warehouse mobile navigation');
assert.match(mobileSource, /href=\{`\$\{base\}\/manual`\}[\s\S]*Other stock receiving/, 'Other stock receiving must remain available from More');
assert.match(warehouseRouteSource, /receiving=\{canReceive \? <InboundReceivingLauncher mobile/, 'Mobile receiving must use the existing/manual PO launcher');
assert.match(warehouseRouteSource, /returns=\{canReturn \? [\s\S]*<ReturnReceiving warehouses=\{warehouses\}/, 'Mobile returns must use the focused receiving lookup');
assert.match(warehouseRouteSource, /manual=\{canReceive \? <ManualReceivingPanel mobile/, 'Other stock must remain available as a secondary manual receipt flow');
assert.match(returnReceivingSource, /scope="all" label="Scan return tracking"/, 'Mobile return receiving must scan both return and linked order tracking');
assert.match(returnReceivingSource, /Return, order, tracking, name, phone, ZIP, email, SKU or UPC/, 'Mobile return receiving must expose warehouse-standard lookup fields');
assert.match(returnReceivingSource, /DataPlus order[\s\S]*Channel order[\s\S]*Channel return/, 'Return results must show internal and channel identities');
assert.doesNotMatch(returnReceivingSource, /<Phone|<Mail/, 'Return results must not display customer phone or email');
assert.match(returnReceivingSource, /customer\.city[\s\S]*customer\.state[\s\S]*customer\.postalCode/, 'Return results must show city, state, and ZIP');
assert.match(returnReceivingSource, /defaultImage[\s\S]*<img src=\{item\.image\}/, 'Return results must render catalog product images');
assert.match(returnReceivingSource, /compressEvidenceImage\(file,[\s\S]*maxBytes: 900_000[\s\S]*capture="environment"[\s\S]*Save receipt\{photos\.length/, 'Return receiving must compress, preview, and explicitly save mobile photos');
assert.match(returnReceivingSource, /savedPhotoIds[\s\S]*one or more photos were not returned as saved evidence/, 'Return receiving must verify photo persistence before reporting success');
assert.match(returnReceivingSource, /stockPhotoRequired[\s\S]*1 required[\s\S]*stockPhotoRequired && photos\.length < 1/, 'New items marked for restock must require one receipt photo');
assert.match(returnReceivingSource, /Qualifies for vendor return review[\s\S]*Use vendor return[\s\S]*return_to_vendor/, 'Eligible returns must show the 30-day vendor-return notice and disposition shortcut');
assert.match(returnReceivingSource, /selectedWarehouse[\s\S]*activeBins[\s\S]*Choose a bin/, 'Selecting a return warehouse must load its active bins');
assert.doesNotMatch(returnReceivingSource, /disabled=\{busy \|\| !draft\.warehouseId/, 'Warehouse selection must remain optional for a receipt-only return');
assert.match(warehouseRouteSource, /const beginQuickCreate = \(draft\?[\s\S]*quickCreatePhotoInputRef\.current\?\.click\(\)/, 'Warehouse quick create must open the product camera directly');
assert.match(warehouseRouteSource, /<DialogTitle>Quick create product<\/DialogTitle>[\s\S]*\{manualPhotoUrls\.length\}\/8 photos[\s\S]*Take another[\s\S]*Create draft SKU/, 'Warehouse quick create must support a compact multi-photo capture flow');
assert.match(warehouseRouteSource, /Quick create unit of measure[\s\S]*Quick create case pack/, 'Warehouse quick create must collect UOM and case pack');
assert.match(warehouseRouteSource, /UOM \{lastScan\.uomName[\s\S]*Case pack \{Math\.max/, 'Matched scans must display UOM and case pack');
assert.match(warehouseRouteSource, /if \(resumeScanner\) setCameraOpen\(true\)/, 'Camera quick create must return the worker to barcode scanning');
assert.match(appSource, /href="\/warehouse\/mobile"[\s\S]*Warehouse Mobile/, 'The mobile account menu must link to Warehouse Mobile');
assert.match(appSource, /canReturn=\{userCan\(authUser, "orders\.returns", "view"\)/, 'Warehouse Mobile must apply return permissions to the focused receiving flow');
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
