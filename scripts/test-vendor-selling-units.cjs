const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { sellingUnits, permitsUnit, validateSellingUnitMode } = require('../lib/vendor-selling-units');
const vendor = mode => ({ variationRules: { sellingUnitMode: mode } });
const item = { sku: 'TEST', uom: 'EA', uomQty: 4 };
for (const [mode, each, pack] of [['individual-only', true, false], ['case-only', false, true], ['individual-and-case', true, true], ['supplier-uom', false, true]]) {
  const policy = sellingUnits(vendor(mode), item);
  assert.equal(permitsUnit(policy, 1), each, mode);
  assert.equal(permitsUnit(policy, 4), pack, mode);
  assert.equal(permitsUnit(policy, 8), false);
}
assert.equal(sellingUnits(vendor('case-only'), { uomQty: 1 }).individual, false);
assert.equal(sellingUnits(vendor('case-only'), { uomQty: 1 }).cases, false);
assert.equal(sellingUnits(vendor('individual-and-case'), { ...item, minQuantity: 4 }).individual, true);
assert.equal(sellingUnits(vendor('individual-only'), { ...item, minQuantity: 4 }).individual, true);
const feed = { sku: 'BUS102278TRV', uom: 'EA', uom_qty: '1', min_quantity: '4' };
const feedPolicy = sellingUnits(vendor('individual-and-case'), feed);
assert.equal(feedPolicy.sourceQty, 4);
assert.equal(feedPolicy.supplierMinimumQuantity, 4);
assert.equal(feedPolicy.individual, true);
assert.equal(feedPolicy.cases, true);
assert.equal(sellingUnits(vendor('inherit'), feed).individual, false);
assert.equal(sellingUnits(vendor('supplier-uom'), feed).individual, false);
assert.equal(sellingUnits(vendor('case-only'), feed).individual, false);
assert.equal(sellingUnits(vendor('supplier-uom'), { uomQty: 1 }).individual, true);
assert.equal(sellingUnits({ variationRules: { shopifyVariantMode: 'each-and-uom' } }, item).individual, true);
assert.equal(sellingUnits({ variationRules: { shopifyVariantMode: 'uom-only' } }, item).individual, false);
assert.throws(() => validateSellingUnitMode('unknown'), /valid supplier/);

const filename = path.resolve(__dirname, '../server.js');
const source = fs.readFileSync(filename, 'utf8');
let mode = 'individual-and-case';
const context = {
  require: createRequire(filename),
  productVariationRules: () => ({ sellingUnitMode: mode }),
  productUomQty: p => Number(p.uomQty || 1),
  productHasMinimumSellMultiple: p => Number(p.minQuantity || 1) > 1,
  variantBaseSku: p => p.sku,
  variantSkuFromBase: (sku, suffix) => `${sku}-${suffix}`,
  normalizeSystemVariant: (v, p) => ({ ...v, uomQty: v.uomQty || p.uomQty }),
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function systemProductVariants('), source.indexOf('function pricedFromCost(')), context);
const db = {};
assert.deepEqual(Array.from(context.systemProductVariants(item, db), row => row.uomQty), [1, 4]);
mode = 'case-only';
assert.deepEqual(Array.from(context.systemProductVariants(item, db), row => row.uomQty), [4], 'Rule changes invalidate the in-memory variant cache');
mode = 'individual-only';
assert.deepEqual(Array.from(context.systemProductVariants(item, db), row => row.uomQty), [1]);
assert.deepEqual(Array.from(context.systemProductVariants({ ...item, minQuantity: 4 }, db), row => row.uomQty), [1]);
mode = 'individual-and-case';
assert.deepEqual(Array.from(context.systemProductVariants(feed, db), row => row.uomQty), [1, 4]);
mode = 'case-only';
assert.equal(context.systemProductVariants({ ...item, uomQty: 1 }, db).length, 0);
assert.equal((source.match(/variationRuleFields = new Set\(\["shopifyVariantMode", "allowShopifyVariations", "sellingUnitMode"/g) || []).length, 2, 'Both vendor save paths must allow the new setting');
const appSource = fs.readFileSync(path.resolve(__dirname, '../web/src/App.tsx'), 'utf8');
assert.match(appSource, /Individual Each/);
assert.match(appSource, /Supplier-defined unit/);
assert.match(appSource, /updateSellingUnitPermission\("individual"/);
assert.match(appSource, /updateSellingUnitPermission\("supplier"/);
assert.match(appSource, /Keep at least one selling unit enabled/);

const stockFile = path.resolve(__dirname, 'shopify-inventory-update-from-dump.js');
const stockSource = fs.readFileSync(stockFile, 'utf8');
const stockContext = { require: createRequire(stockFile), productUomQty: p => p.uomQty };
vm.createContext(stockContext);
vm.runInContext(stockSource.slice(stockSource.indexOf('function supplierUnitQuantity('), stockSource.indexOf('function expectedVariantQuantities(')), stockContext);
assert.equal(stockContext.supplierUnitQuantity({ uomQty: 1, quantity: 20 }, { ...item, safetyVendor: vendor('case-only') }).quantity, 0);
assert.equal(stockContext.supplierUnitQuantity({ uomQty: 4, quantity: 20 }, { ...item, safetyVendor: vendor('individual-only') }).quantity, 0);
assert.equal(stockContext.supplierUnitQuantity({ uomQty: 4, quantity: 20 }, { ...item, safetyVendor: vendor('individual-and-case') }).quantity, 20);
assert.equal(stockContext.supplierUnitQuantity({ uomQty: 1, quantity: 20 }, { ...item, minQuantity: 4, safetyVendor: vendor('individual-and-case') }).quantity, 20);
vm.runInContext(stockSource.slice(stockSource.indexOf('function productUomQty('), stockSource.indexOf('function variantSku(')), stockContext);
assert.equal(stockContext.productUomQty({ ...feed, safetyVendor: vendor('individual-and-case') }), 4, 'Inventory sync retains the purchase pack when feed UOM is Each');
const exportFile = path.resolve(__dirname, 'fast-shopify-variation-export.js');
const exportSource = fs.readFileSync(exportFile, 'utf8');
const exportContext = {
  require: createRequire(exportFile), UOM_DEFINITIONS: { EA: 'Each' },
  number: (value, fallback) => Number(value) || fallback,
  roundedPrice: value => Math.round(value * 100) / 100,
  unitCost: p => p.cost, availableQty: () => 20,
  classifyShipping: () => ({ shippingClass: 'parcel' }), priceIncludingFreight: price => price,
  applyPricePolicy: require('../lib/channel-price-policy').applyPricePolicy,
};
vm.createContext(exportContext);
vm.runInContext(exportSource.slice(exportSource.indexOf('function uomInfo('), exportSource.indexOf('function availableQty(')), exportContext);
vm.runInContext(exportSource.slice(exportSource.indexOf('function variants('), exportSource.indexOf('function buildCategoryMaps(')), exportContext);
const exportRows = exportContext.variants({ ...feed, supplier: 'True Value', cost: 5.37, minimumAllowedPrice: 5.26 }, {}, { vendors: [{ ...vendor('individual-and-case'), name: 'True Value' }] });
assert.deepEqual(Array.from(exportRows, row => row.uomQty), [4, 1]);
assert.deepEqual(Array.from(exportRows, row => row.cost), [21.48, 5.37]);
assert.equal(feed.uom_qty, '1', 'Source UOM is not rewritten');
assert.equal(feed.min_quantity, '4', 'Supplier purchasing minimum is preserved');
console.log('Supplier unit modes, minimum quantities, variant cache, save paths and Shopify inventory gates passed.');
