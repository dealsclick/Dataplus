const assert = require('node:assert/strict');
const { calculateChannelPrice, normalizeMode, normalizeRoundingRule } = require('../lib/channel-price-formula');

assert.equal(calculateChannelPrice({ cost: 10, markupPercent: 28 }), 12.8);
assert.equal(calculateChannelPrice({ cost: 10, markupPercent: 10, minMarginPercent: 20 }), 12.5);
assert.equal(calculateChannelPrice({ cost: 10, productPrice: 15, pricingMode: 'higher-of-product-or-cost', markupPercent: 28 }), 15);
assert.equal(calculateChannelPrice({ cost: 10, productPrice: 8, pricingMode: 'product-price', minimumPrice: 12 }), 12);
assert.equal(calculateChannelPrice({ cost: 10, markupPercent: 28, roundingRule: 'nearest .99' }), 12.99);
assert.equal(calculateChannelPrice({ cost: 10, markupPercent: 28, roundingRule: 'nearest .95' }), 12.95);
assert.equal(calculateChannelPrice({ cost: 10, markupPercent: 28, roundingRule: 'round up' }), 13);
assert.equal(normalizeMode('bad'), 'cost-plus');
assert.equal(normalizeRoundingRule('bad'), 'none');
console.log('Channel price formula modes, margin floor, channel minimum and rounding passed.');
