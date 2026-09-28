const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { sellingUnits } = require('../lib/vendor-selling-units');
const source = fs.readFileSync(require.resolve('../lib/walmart-marketplace'), 'utf8');
let mode = 'individual-and-case';
const p = { id: 'test', sku: 'TEST', uomQty: 4, minQuantity: 4, active: true, packageWeight: 1 };
const context = {
  isDataWarehouseLocation: require('../lib/inventory-locations').isDataWarehouseLocation,
  deps: { sellingUnits: item => sellingUnits({ variationRules: { sellingUnitMode: mode } }, item), packSize: () => 1, sourcePackSize: item => item.uomQty },
  productIsMasterInactive: item => item.active === false, walmartSupplierBlock: () => false,
  shippingRestriction: () => ({ blocked: false }),
  fail: message => new Error(message), requireVerified: async () => {},
  enabled: async () => ({ id: 'channel', settings: { walmartShipNode: 'node' } }),
  product: async () => p, readDb: async () => ({ vendors: [] }), sellerSku: async () => p.sku,
  credentialKey: async () => 'fixture', digest: value => JSON.stringify(value),
  identifier: () => ({ productIdType: 'UPC', value: '036000291452', kind: 'upc' }),
  read: async () => null, mappingKey: value => value,
  client: { request: async url => url.includes('/search?') ? { items: [{ feedType: 'MP_ITEM_MATCH', version: '4.2', itemSpecPayload: { MPItemFeedHeader: {}, MPItem: [{ Item: {} }] } }] } : { ItemResponse: [{ sku: 'TEST' }] } },
  object: value => value || {}, priceFor: () => 12.50, spec: async () => ({}), validatePayload: () => [],
  inventoryAmount: item => item.active === false ? 0 : 20,
  structuredClone, URLSearchParams, crypto, stamp: () => new Date().toISOString(),
  write: async () => {}, log: () => {},
};
vm.createContext(context);
for (const [start, end] of [
  ['  function launchGate(', '  async function spec('],
  ['  async function prepare(', '  async function readinessFingerprint('],
  ['  async function operationPlan(', '  async function zeroInactive('],
]) {
  assert(source.includes(start) && source.includes(end));
  vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
}
context.prepareUpdate = context.operationPlan;
async function main() {
  const fingerprint = await context.launchFingerprint(p, null, {}, {});
  mode = 'case-only';
  await assert.rejects(context.prepare('TEST'), /do not allow individual/);
  assert.notEqual(await context.launchFingerprint(p, null, {}, {}), fingerprint);
  assert.equal((await context.prepareUpdate('inventory', 'TEST')).body.quantity.amount, 0);
  mode = 'individual-and-case';
  await assert.rejects(context.prepare('TEST'), /Confirm the UPC/);
  const form = await context.prepare('TEST', {}, 'actor', true);
  assert.equal(form.packSize, 1);
  assert.equal(form.requiresIndividualIdentifierReview, true);
  const preview = await context.prepare('TEST', { confirmIndividualIdentifier: true }, 'actor');
  assert.equal(preview.sellingUnitQty, 1);
  assert.equal(preview.price, 12.50);
  assert.equal(preview.payload.MPItem[0].Item.quantity, undefined);
  await assert.rejects(context.prepare('TEST', { confirmIndividualIdentifier: true, orderable: { multipackQuantity: 4 } }), /individual offers/);
  await assert.rejects(context.prepareUpdate('price', 'TEST'), /unverified/);
  await assert.rejects(context.prepareUpdate('inventory', 'TEST'), /unverified/);
  p.active = false;
  assert.equal((await context.prepareUpdate('inventory', 'TEST')).body.quantity.amount, 0);
  p.active = true;
  p.walmartListing = { sellingUnitQty: 1 };
  assert.equal((await context.prepareUpdate('inventory', 'TEST')).body.quantity.amount, 20);
  assert.equal((await context.prepareUpdate('price', 'TEST')).body.pricing[0].currentPrice.amount, 12.50);
  p.uomQty = 1;
  assert.equal((await context.prepare('TEST', {}, 'actor')).sellingUnitQty, 1);
  context.enabled = async () => ({ id: 'channel', settings: { walmartShipNode: 'node', walmartWarehouseId: 'datawarehouse' } });
  context.readDb = async () => ({ vendors: [], warehouses: [{id:'datawarehouse', inventorySourceType:'supplier_feed'}] });
  let dumpStatus = 'stopped';
  context.postgres = {getPool: () => ({query: async () => ({rows: dumpStatus ? [{status:dumpStatus}] : []})})};
  assert.equal((await context.prepareUpdate('inventory','TEST')).body.quantity.amount,20);
  dumpStatus = 'running';
  assert.equal((await context.prepareUpdate('inventory','TEST')).body.quantity.amount,20);
  dumpStatus = '';
  assert.equal((await context.prepareUpdate('inventory','TEST')).body.quantity.amount,20);
  dumpStatus = 'success';
  assert.equal((await context.prepareUpdate('inventory','TEST')).body.quantity.amount,20);
  dumpStatus = 'failed'; p.active = false;
  assert.equal((await context.prepareUpdate('inventory','TEST')).body.quantity.amount,0);
  console.log('Walmart individual-unit gates, preview invalidation, identifier review, pricing and zero inventory passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
