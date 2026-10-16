const assert = require('node:assert/strict');
const {
  orderLineHasAuthoritativeStoredCost,
  resolveOrderLineCatalogCost
} = require('../server');

const product = {
  id: 'product-1',
  sku: 'BUS142504TRV',
  supplier: 'True Value',
  uom: 'EA',
  uomQty: 10,
  cost: 7.70,
  sourceCost: 7.70,
  price: 9.97,
  systemVariants: [{ sku: 'BUS142504TRV-10PC', uomQty: 10, unitCost: 7.70 }],
  aliases: [{ aliasSku: 'TV-142504', active: true }]
};
const byKey = new Map([
  ['bus142504trv', product],
  ['bus142504trv-10pc', product],
  ['tv-142504', product]
]);

assert.equal(orderLineHasAuthoritativeStoredCost({ cost: 0 }), false, 'marketplace zero is an unknown placeholder');
assert.equal(orderLineHasAuthoritativeStoredCost({ cost: 0, costSource: 'manual' }), true, 'explicit zero remains valid');
assert.equal(orderLineHasAuthoritativeStoredCost({ cost: 7.70 }), true, 'positive imported cost remains historical evidence');
assert.equal(resolveOrderLineCatalogCost({ source: 'eBay' }, { sku: 'BUS142504TRV' }, byKey).unitCost, 7.70);
assert.equal(resolveOrderLineCatalogCost({ source: 'eBay' }, { sku: 'TV-142504' }, byKey).unitCost, 7.70);

console.log('PASS order cost hydration: unknown marketplace zero falls back to catalog each-unit cost');
