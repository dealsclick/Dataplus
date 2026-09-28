const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const safety = require('../lib/inventory-safety');
const vendor = { id: 'rjs', name: 'RJS', inventoryRules: { safetyQty: 7 }, catalogSettings: { sourceCodes: ['RZ'] } };
assert.deepEqual(safety.resolveInventorySafety({}, null, 3), { quantity: 3, source: 'channel' });
assert.equal(safety.resolveInventorySafety({}, vendor, 3).quantity, 7);
assert.equal(safety.resolveInventorySafety({}, { inventoryRules: { safetyQty: 0 } }, 3).quantity, 0);
assert.equal(safety.resolveInventorySafety({}, { inventoryRules: { safetyQty: null } }, 3).quantity, 3);
assert.equal(safety.resolveInventorySafety({ bypassSafetyQty: true }, vendor, 3).quantity, 0);
assert.equal(safety.resolveInventorySafety({ raw: { bypassSafetyQty: true } }, vendor, 3).quantity, 0);
for (const invalid of [-1, 1.5, 'abc', Infinity]) assert.throws(() => safety.optionalSafetyQty(invalid));
for (const empty of [undefined, null, '']) assert.equal(safety.optionalSafetyQty(empty), null);
assert.equal(safety.safetyVendor({ vendorId: 'rjs' }, [vendor]), vendor);
assert.equal(safety.safetyVendor({ supplier_code: 'RZ' }, [vendor]), vendor);
assert.equal(safety.safetyVendor({ supplier: 'RJS similar name' }, [vendor]), null);
assert.equal(safety.safetyVendor({ supplierCode: 'ABC' }, [{ ...vendor, catalogSettings: { sourceCodes: 'ABC,DEF' } }]).id, 'rjs');

function functions(file, start, end, context) {
  const filename = path.resolve(__dirname, file);
  const source = fs.readFileSync(filename, 'utf8');
  context.require = createRequire(filename);
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), context);
  return context;
}
const server = functions('../server.js', 'function mappedInventoryQuantity(', 'function reconcileChannelWarehouseMappings(', {});
assert.equal(server.mappedInventoryQuantity(20, {}, { defaultSafetyQty: 3 }, { vendorId: 'rjs' }, [vendor]), 13);
assert.equal(server.mappedInventoryQuantity(20, {}, { defaultSafetyQty: 3 }, { vendorId: 'rjs', bypassSafetyQty: true }, [vendor]), 20);
assert.equal(server.mappedInventoryQuantity(5, {}, {}, { vendorId: 'rjs' }, [vendor]), 0);
assert.equal(server.mappedInventoryQuantity(20, { inventoryMode: 'fixed', fixedQty: 12 }, {}, { vendorId: 'rjs' }, [vendor]), 5);
assert.equal(server.mappedInventoryQuantity(20, { inventoryMode: 'disabled' }, {}, { bypassSafetyQty: true }), 0);
const shopify = functions('shopify-inventory-update-from-dump.js', 'function channelSellableQuantity(', 'function productShippingDimensionValue(', {
  textValue: v => String(v || '').trim(), numberValue: (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback
});
const item = { qty: 20, reserved: 2, safetyVendor: vendor };
const before = JSON.stringify(item);
assert.equal(shopify.channelSellableQuantity(18, { safetyQty: 3 }, item), 11);
assert.equal(shopify.channelSellableQuantity(18, { safetyQty: 3 }, { ...item, bypassSafetyQty: true }), 18);
assert.equal(shopify.channelSellableQuantity(18, { inventoryMode: 'fixed', fixedQty: 12 }, item), 5);
assert.equal(JSON.stringify(item), before);
const { inventoryAmount } = require('../lib/walmart-operations');
const inventoryDb = { vendors: [vendor], warehouses: [{ id: 'physical', isPhysical: true }] };
const settings = { walmartWarehouseId: 'physical', walmartSafetyQty: 3 };
const product = { vendorId: 'rjs', warehouseStock: [{ warehouseId: 'physical', qty: 40, reserved: 4 }] };
assert.equal(inventoryAmount(product, inventoryDb, settings, 4), 2);
assert.equal(inventoryAmount({ ...product, bypassSafetyQty: true }, inventoryDb, settings, 4), 9);
assert.equal(inventoryAmount({ ...product, bypassSafetyQty: true, active: false }, inventoryDb, settings, 4), 0);
const serverSource = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const configStart = serverSource.indexOf('  const useChannelDefaultQuantity =', serverSource.indexOf('function ebayListingConfig('));
const quantityBlock = serverSource.slice(configStart, serverSource.indexOf('  const minInventoryForAutoListing =', configStart));
function ebayQuantity(item, productSettings = {}, body = {}) {
  const context = { require: createRequire(path.resolve(__dirname, '../server.js')), item, productSettings, body,
    db: { vendors: [vendor] }, effectiveSettings: { ebayDefaultSafetyQty: 3 }, saved: {}, actualAvailableQuantity: 20,
    channelShippingRestriction: () => ({ blocked: false }), productIsMasterInactive: p => p.active === false,
    retiredSupplier: () => null, marketplaceListingQuantity: (p, s) => Math.max(0, 20 - s.ebaySafetyQty) };
  vm.createContext(context);
  return vm.runInContext(`${quantityBlock}\nquantity;`, context);
}
assert.equal(ebayQuantity({ vendorId: 'rjs' }), 13);
assert.equal(ebayQuantity({ vendorId: 'rjs', bypassSafetyQty: true }), 20);
assert.equal(ebayQuantity({ vendorId: 'rjs' }, {}, { quantity: 10 }), 3);
assert.equal(ebayQuantity({ vendorId: 'rjs', active: false, bypassSafetyQty: true }), 0);
console.log('Inventory safety precedence, identity, fixed quantity, clamp, Walmart and bypass tests passed.');
