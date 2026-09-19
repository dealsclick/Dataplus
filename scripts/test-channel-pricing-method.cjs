const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { channelCostPrice, validatePricingMethod } = require('../lib/channel-pricing-method');
const { applyWalmartSettings } = require('../lib/walmart-settings');
const margin = { pricingMethod: 'gross-margin', pricingPercent: 28 };
assert.equal(channelCostPrice(5.37, margin), 7.46);
assert.equal(channelCostPrice(5.37, { pricingMethod: 'markup', pricingPercent: 28 }), 6.88);
assert.equal(channelCostPrice(5.37, {}, 6.87), 6.87);
assert.equal(channelCostPrice(5.37, { pricingMethod: 'legacy' }, 7.95), 7.95);
assert.equal(channelCostPrice(5.37, { ...margin, pricingPercent: 0 }), 5.37);
assert.equal(channelCostPrice(0, margin), 0);
assert.equal(channelCostPrice(NaN, margin), 0);
for (const percent of [-1, 100, Infinity, 'invalid']) assert.throws(() => validatePricingMethod({ ...margin, pricingPercent: percent }), /Invalid/);
assert.throws(() => validatePricingMethod({ pricingMethod: 'net-profit' }), /Invalid/);
assert.deepEqual(applyWalmartSettings({}, { settings: margin }), margin);
assert.throws(() => applyWalmartSettings({}, { settings: { ...margin, pricingPercent: 100 } }), /Invalid/);
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
const context = { channelCostPrice, marketplaceItemCost: () => 5.37, marketplaceBaseSellPrice: () => 6.87 };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function roundMarketplacePrice('), source.indexOf('function marketplaceListingQuantity(')), context);
assert.equal(context.marketplaceSuggestedPrice({}, margin), 7.46);
assert.equal(context.marketplaceSuggestedPrice({}, { ...margin, ebayPricingMode: 'product-price' }), 7.46);
assert.equal(context.marketplaceSuggestedPrice({}, { ...margin, ebayRoundingRule: 'nearest .95' }), 7.95);
const boundary = context.marketplaceSuggestedPrice({}, { ...margin, ebayRoundingRule: 'nearest .95' }, { cost: 7.18, price: 1 });
assert.ok((boundary - 7.18) / boundary >= .28);
assert.equal(context.marketplaceSuggestedPrice({}, { ebayPriceMarkupPercent: 30 }), 6.98);
assert.equal(context.marketplaceSuggestedPrice({}, { ...margin, ebayMinimumPrice: 12 }), 12);
assert.ok(source.includes("pricingMethod: 'legacy', ...productSettings"));
const walmartContext = {
  channelCostPrice,
  productEachUnitCost: p => p.cost,
  websitePriceFromRule: (p, cost, markup) => cost * (1 + markup / 100),
  productUsesSellUnitPricing: () => false,
  productUomQty: () => 1,
  findChannelByName: () => null,
  applyPricePolicy: require('../lib/channel-price-policy').applyPricePolicy,
};
vm.createContext(walmartContext);
const walmartStart = source.indexOf('    priceFor: (product, db, settings) => {');
const walmartEnd = source.indexOf('    findActive:', walmartStart);
const walmartPrice = vm.runInContext(`({${source.slice(walmartStart, walmartEnd)}}).priceFor`, walmartContext);
assert.equal(walmartPrice({ cost: 5.37 }, {}, margin), 7.46);
assert.equal(walmartPrice({ cost: 5.37, price: 10 }, {}, margin), 10);
assert.equal(walmartPrice({ cost: 5.37, mapPrice: 11 }, {}, margin), 11);
assert.throws(() => walmartPrice({ cost: 0 }, {}, margin), /positive individual-unit cost/);
console.log('Channel pricing method tests passed.');
