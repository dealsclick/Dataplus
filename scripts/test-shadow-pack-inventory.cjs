const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const filename = path.resolve(__dirname, '../server.js');
const source = fs.readFileSync(filename, 'utf8');
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
  shadowSkus: [{ shadowSku: 'BUS76655RJS-3PK', marketplaceSku: 'B084P9759D', unitsPerPack: 3 }]
};

assert.equal(context.inventorySkuMatch('BUS76655RJS-3PK', product).multiplier, 3);
assert.equal(context.inventorySkuMatch('B084P9759D', product).multiplier, 3);
assert.equal(context.orderLineInventoryMultiplier({ sku: 'BUS76655RJS', originalSku: 'B084P9759D' }, product), 3);
assert.equal(context.orderLineInventoryMultiplier({ sku: 'BUS76655RJS' }, product), 12);
assert.equal(context.purchaseReceiptInventoryMultiplier(product), 12);
assert.equal(context.purchaseReceiptInventoryMultiplier({ ...product, inventoryTrackingMode: '' }), 1);
assert.match(source, /type: "drop_ship"[\s\S]{0,500}inventoryQty: remaining \* inventoryMultiplier, inventoryMultiplier/);
assert.match(source, /type: "purchase"[\s\S]{0,500}inventoryQty: remaining \* inventoryMultiplier, inventoryMultiplier/);

console.log('Shadow pack inventory tests passed.');
