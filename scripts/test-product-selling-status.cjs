const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { productIsMasterInactive } = require('../lib/product-selling-status');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const shopify = fs.readFileSync(path.join(__dirname, 'shopify-inventory-update-from-dump.js'), 'utf8');
const context = {
  productIsMasterInactive,
  retiredSupplier: () => null,
  channelShippingRestriction: () => ({ blocked: false }),
  baseSkuCandidates: () => ['SKU'],
  booleanValue: v => v === true,
  numberValue: (v, fallback) => Number(v) || fallback,
  channelSellableQuantity: () => 999,
  productUomQty: () => 12,
  variantSku: (sku, suffix) => `${sku}-${suffix}`,
  textValue: v => String(v || '').trim(),
  parseShopifyPackVariantSku: sku => sku === 'SKU-24PC' ? { uomQty: 24 } : null
};
vm.createContext(context);
vm.runInContext(server.slice(server.indexOf('function marketplaceListingQuantity('), server.indexOf('function ebayListingDescription(')), context);
vm.runInContext(shopify.slice(shopify.indexOf('function expectedVariantQuantities('), shopify.indexOf('function requestJson(')), context);
const stock = { qty: 100, stockQty: 100, source_qty: 100, replenishable: true, replenishable_qty: 500 };
for (const status of [{ active: false }, { active: 'false' }, { active: 0 }, { status: ' Inactive ' }, { status: 'DISABLED' }, { deleted: true }]) {
  const item = { ...stock, ...status };
  const before = JSON.stringify(item);
  assert.equal(productIsMasterInactive(item), true);
  assert.equal(context.marketplaceListingQuantity(item, { ebayQuantityMode: 'qty' }), 0);
  for (const packMode of ['divide', 'export']) {
    assert(context.expectedVariantQuantities(item, { packMode }).every(row => row.quantity === 0));
    const rows = context.expectedVariantQuantitiesForShopify(item, [{ sku: 'SKU' }, { sku: 'SKU-24PC' }], { packMode });
    assert.equal(rows.length, 2);
    assert(rows.every(row => row.quantity === 0));
  }
  assert.equal(JSON.stringify(item), before, 'physical/source quantities must not be mutated');
}
for (const item of [{}, { active: true }, { active: 'true', status: 'Active' }]) assert.equal(productIsMasterInactive(item), false);
assert.equal(context.marketplaceListingQuantity(stock), 100);
assert.equal(context.expectedVariantQuantities(stock)[0].quantity, 999);
vm.runInContext(server.slice(server.indexOf('function productEbayLaunchBlockReason('), server.indexOf('function productEbayLaunchInventoryWarning(')), context);
assert.match(context.productEbayLaunchBlockReason({ ...stock, active: false }), /Master inactive/);
vm.runInContext(server.slice(server.indexOf('function shopifyInventoryColumnValue('), server.indexOf('function shopifyVariantSku(')), context);
for (const column of ['Inventory Available: Main', 'Inventory On Hand: Main']) assert.equal(context.shopifyInventoryColumnValue({}, { ...stock, active: false }, column), 0);
const fastExport = fs.readFileSync(path.join(__dirname, 'fast-shopify-variation-export.js'), 'utf8');
const exportStart = fastExport.indexOf('function valueFor(');
// Evaluate only the early guard; reaching normal export logic fails this test.
vm.runInContext(fastExport.slice(exportStart, fastExport.indexOf('  const mapping =', exportStart)) + '\nthrow new Error("Inactive export guard bypassed");\n}', context);
for (const column of ['Variant Inventory Qty', 'Total Inventory Qty', 'Inventory Available: Main', 'Inventory On Hand: Main']) assert.equal(context.valueFor(column, '', { ...stock, active: false }), 0);
assert(server.includes('const quantity = productIsMasterInactive(item) ? 0 :'), 'eBay overrides cannot bypass the final quantity gate');
assert(shopify.includes('p.active,'), 'sync must load catalog active status');
console.log('Product master inactive tests passed.');
