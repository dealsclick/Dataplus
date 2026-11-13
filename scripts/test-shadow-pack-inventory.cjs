const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const filename = path.resolve(__dirname, '../server.js');
const source = fs.readFileSync(filename, 'utf8');
const shadowContext = { crypto: require('node:crypto') };
vm.createContext(shadowContext);
const shadowStart = source.indexOf('function normalizeShadowSku(');
const shadowEnd = source.indexOf('function normalizedWarehouseShadowCode', shadowStart);
vm.runInContext(source.slice(shadowStart, shadowEnd), shadowContext);
const normalizedShadow = shadowContext.normalizeShadowSku({
  marketplace: 'Temu',
  shadowSku: 'BUS76655RJS-3PK',
  unitsPerPack: 3,
  inventoryEnabled: false,
  channelListings: {
    temu: { enabled: false, inventoryEnabled: false },
    ebay: { enabled: true, inventoryEnabled: true, price: 19.99 }
  }
}, { sku: 'BUS76655RJS', price: 17.99 });
assert.equal(normalizedShadow.inventoryEnabled, false);
assert.equal(normalizedShadow.channelListings.ebay.price, 19.99);
assert.equal(normalizedShadow.channelListings.temu.enabled, false);
assert.ok(normalizedShadow.channels.includes('Temu'));
assert.ok(normalizedShadow.channels.includes('ebay'));

const context = {
  productUomQty: item => Number(item.uomQty || 1),
  orderSkuBaseFromUomVariant: value => String(value || '').replace(/[-_](\d+)(?:PC|PK|PACK|CT|CS|CASE|BX|EA|EACH)$/i, '')
};
vm.createContext(context);
const start = source.indexOf('function inventorySkuCandidates(');
const end = source.indexOf('const inventoryAdjustmentReasons', start);
vm.runInContext(source.slice(start, end), context);

const product = {
  sku: 'BUS76655RJS',
  uomQty: 12,
  inventoryTrackingMode: 'piece',
  aliases: [
    { aliasSku: 'BUS76655RJS-3PK', inventoryMultiplier: 3 },
    { aliasSku: 'B084P9759D', inventoryMultiplier: 3 }
  ],
  shadowSkus: [{ id: 'shadow-3pk', shadowSku: 'BUS76655RJS-3PK', merchantSku: 'BUS76655RJS-3PK', marketplaceSku: 'BUS76655RJS', channelSku: '44129312577504', unitsPerPack: 3 }]
};

assert.equal(context.inventorySkuMatch('BUS76655RJS-3PK', product).multiplier, 3);
assert.equal(context.inventorySkuMatch('44129312577504', product).multiplier, 3);
assert.equal(context.orderLineInventoryMultiplier({ sku: 'BUS76655RJS', merchantSku: 'BUS76655RJS-3PK' }, product), 3);
assert.equal(context.orderLineInventoryMultiplier({ sku: 'BUS76655RJS' }, product), 12);
assert.equal(context.purchaseReceiptInventoryMultiplier(product), 12);
assert.equal(context.purchaseReceiptInventoryMultiplier({ ...product, inventoryTrackingMode: '' }), 1);
assert.match(source, /type: "drop_ship"[\s\S]{0,500}inventoryQty: remaining \* inventoryMultiplier, inventoryMultiplier/);
assert.match(source, /type: "purchase"[\s\S]{0,500}inventoryQty: remaining \* inventoryMultiplier, inventoryMultiplier/);

const costContext = {
  orderSkuBaseFromUomVariant: value => String(value || ''),
  productEachUnitCost: () => 16.15 / 12,
  productUsesSellUnitPricing: () => true,
  productSellUnitCost: () => 16.15,
  shopifyVariantPriceBasis: () => 0
};
vm.createContext(costContext);
const costStart = source.indexOf('function orderProductLookup(');
const costEnd = source.indexOf('async function hydrateOrdersLocalCosts', costStart);
vm.runInContext(source.slice(costStart, costEnd), costContext);
const productLookup = costContext.orderProductLookup([product]);
const resolvedCost = costContext.resolveOrderLineCatalogCost({}, {
  sku: product.sku,
  shadowId: 'shadow-3pk',
  merchantSku: 'BUS76655RJS-3PK',
  inventoryMultiplier: 3
}, productLookup);
assert.equal(resolvedCost.matchedShadow.shadowSku, 'BUS76655RJS-3PK');
assert.equal(resolvedCost.shadowUnitsPerPack, 3);
assert.equal(resolvedCost.unitCost, 4.0375);
assert.match(source, /Math\.floor\(Math\.max\(0, shadowAvailablePieces - shadowSafetyQty\) \/ shadowUnitsPerPack\)/);
assert.match(source, /shadowPackCost = shadow \? Math\.round\(productEachUnitCost\(parentItem, workDb\) \* shadowUnitsPerPack/);

console.log('Shadow pack inventory tests passed.');
