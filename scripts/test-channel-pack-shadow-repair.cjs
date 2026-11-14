const assert = require('node:assert/strict');
const {
  matchingLineIndexes,
  shadowAliasValues,
  shadowIdentityValues
} = require('./repair-channel-pack-shadow.cjs');

const shadow = {
  id: 'shadow-3pk',
  shadowSku: 'BUS76655RJS-3PK',
  merchantSku: 'BUS76655RJS-3PK',
  marketplaceSku: 'BUS76655RJS',
  channelSku: '44129312577504',
  unitsPerPack: 3
};
const product = {
  sku: 'BUS76655RJS',
  aliases: [
    { aliasSku: 'B084P9759D', type: 'shadow', source: 'Temu', shadowId: 'shadow-3pk', unitsPerPack: 3, active: true },
    { aliasSku: '44129312577504', type: 'shadow', source: 'Temu', shadowId: 'shadow-3pk', inventoryMultiplier: 3, active: true },
    { aliasSku: 'BUS76655RJS-12PC', type: 'shadow', source: 'Temu', shadowId: 'shadow-12pk', unitsPerPack: 12, active: true },
    { aliasSku: 'OLD-INACTIVE', type: 'shadow', source: 'Temu', shadowId: 'shadow-3pk', unitsPerPack: 3, active: false }
  ]
};
const input = {
  parentSku: product.sku,
  shadowSku: shadow.shadowSku,
  merchantSku: shadow.merchantSku,
  marketplaceSku: shadow.marketplaceSku,
  channelSku: shadow.channelSku,
  marketplace: 'Temu',
  unitsPerPack: 3
};

assert.deepEqual(
  shadowAliasValues(product, shadow, 'Temu', 3).sort(),
  ['44129312577504', 'B084P9759D'].sort()
);

const identifiers = shadowIdentityValues(product, shadow, input);
assert.ok(identifiers.includes('BUS76655RJS'));
assert.ok(identifiers.includes('BUS76655RJS-3PK'));
assert.ok(identifiers.includes('B084P9759D'));
assert.ok(identifiers.includes('44129312577504'));
assert.ok(!identifiers.includes('BUS76655RJS-12PC'));
assert.ok(!identifiers.includes('OLD-INACTIVE'));

const order = {
  items: [
    { sku: 'BUSPGC08285SPR', mappedSku: 'B084P9759D', originalSku: '44129312577504' },
    { sku: 'BUS76655RJS-12PC', mappedSku: 'BUS76655RJS-12PC' }
  ]
};
assert.deepEqual(matchingLineIndexes(order, identifiers), [0]);

console.log('Channel pack shadow historical repair tests passed.');
