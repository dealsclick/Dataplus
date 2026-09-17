const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { classifyShipping } = require('../lib/shipping-classification');
const { freightAllowance, priceIncludingFreight } = require('../lib/shopify-freight-pricing');
const { sourcePriceFloors, variantPriceFloor } = require('../lib/product-price-floors');
assert.equal(priceIncludingFreight(128, 'ltl'), 378);
assert.equal(priceIncludingFreight(128, 'parcel'), 128);
assert.equal(priceIncludingFreight(128, 'missing_measurements'), 128);
assert.equal(priceIncludingFreight(0, 'ltl'), 0);
assert.equal(priceIncludingFreight(NaN, 'ltl'), 0);
assert.equal(priceIncludingFreight(128, 'ltl', { shopifyLtlFreightAllowance: 0 }), 128);
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
const functions = source.slice(source.indexOf('function pricedFromCost('), source.indexOf('const DEFAULT_MARKETPLACE_TEMPLATES'));
const context = {
  SHOPIFY_PRICE_MARKUP_PERCENT: 28, SHOPIFY_MULTIPACK_DISCOUNT_PERCENT: 5,
  DEFAULT_CHANNEL_SETTINGS: { priceMarkupPercent: 28 },
  sourceNumberValue: Number, productSellUnitCost: i => i.cost,
  sourceCatalogCost: i => i.cost, productEachUnitCost: i => i.cost,
  productUsesSellUnitPricing: i => Boolean(i.sellUnit),
  productUomQty: i => i.uomQty || 1,
  productPricingRules: () => ({ enforceMinimumAllowedPrice: true }),
  shopifyVariantPriceBasis: (i, v) => i.cost * (v.uomQty || 1),
  productShippingClassification: classifyShipping,
  findChannelByName: db => db?.connections?.[0] || ({ name: "Shopify", settings: { shopifyLtlFreightAllowance: 250 } }),
  applyPricePolicy: require("../lib/channel-price-policy").applyPricePolicy,
  priceIncludingFreight, sourcePriceFloors, variantPriceFloor
};
vm.createContext(context); vm.runInContext(functions, context);
const price = context.shopifyVariantWebsitePrice;
const ltl = { cost: 100, shipMode: 'LTL' };
assert.equal(price(ltl), 378);
assert.equal(price({ ...ltl, vendorWebsitePrice: 150 }), 378);
assert.equal(price({ ...ltl, minimumAllowedPrice: 160 }), 378);
assert.equal(price({ ...ltl, vendorWebsitePrice: 50 }), 378);
assert.equal(price(ltl, { uomQty: 2 }), 506); // Selling-unit cost * 1.28 + freight, once.
assert.equal(price({ ...ltl, sellUnit: true }, { uomQty: 2 }), 506);
assert.equal(price({ cost: 100 }), 128); // Review is not assumed to be freight.
assert.equal(price({ shipMode: 'LTL', websitePrice: 378 }), 0); // No source basis: never add freight again.
assert.equal(price({ ...ltl, websitePrice: 378 }), 378); // Repeated projection uses source basis.
assert.equal(price({ ...ltl, minimumAllowedPrice: 150 }, { uomQty: 2 }), 506);
assert.equal(price({ ...ltl, mapPrice: 175 }), 378);
assert.equal(price({ ...ltl, mapPrice: 400 }), 400);
assert.equal(price({ ...ltl, mapPrice: 300 }), 378);
assert.equal(price({ ...ltl, mapPrice: 400, lapPrice: 450 }), 450);
assert.equal(price({ ...ltl, vendorWebsitePrice: 999, mapPrice: 400 }), 400);
assert.equal(price({ cost: 100, mapPrice: 150 }, { uomQty: 2 }), 300); // Pack minimum wins over the pack discount.
assert.equal(price({ cost: 100, minimumAllowedPrice: 0, productManagerFields: { minimum_allowed_price: 160 } }), 160);
assert.equal(freightAllowance(classifyShipping({ shipMode: 'LTL' }).shippingClass), 250);
console.log('Shopify 28% markup and post-price freight tests passed.');

const ruleDb = { brands: [{ name: 'Acme', mapPricingMode: 'calculated' }], connections: [{ id: 'shop', name: 'Shopify', settings: { mapPricingMode: 'protected', priceMarkupPercent: 28 } }] };
assert.equal(price({ ...ltl, brand: 'Acme', mapPrice: 450 }, {}, 28, ruleDb), 378);
assert.equal(price({ ...ltl, brand: 'Acme', mapPrice: 450, channelPriceModes: { shop: 'protected' } }, {}, 28, ruleDb), 450);
assert.equal(price({ ...ltl, brand: 'Other', mapPrice: 450, channelPriceModes: { shop: 'calculated' } }, {}, 28, ruleDb), 378);
