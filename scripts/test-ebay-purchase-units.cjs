const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { groupingPolicy, allocateQuantities, assertVariantIdentity, listingTargets } = require('../lib/ebay-variation-plan');
const variants = [{ sku: 'TEST', uomQty: 1 }, { sku: 'TEST-4PC', uomQty: 4 }];
const aspect = { localizedAspectName: 'Number in Pack', aspectConstraint: { aspectEnabledForVariations: true, aspectMode: 'FREE_TEXT' } };
assert.equal(groupingPolicy({ variationsSupported: true }, [aspect], variants).mode, 'group');
assert.equal(groupingPolicy({ variationsSupported: false }, [], variants).mode, 'separate');
assert.equal(groupingPolicy({ variationsSupported: true }, [{ ...aspect, localizedAspectName: 'Color' }], variants).mode, 'separate');
assert.equal(groupingPolicy({ variationsSupported: true }, [{ ...aspect, aspectConstraint: { ...aspect.aspectConstraint, aspectMode: 'SELECTION_ONLY' }, aspectValues: [{ localizedValue: '1' }] }], variants).mode, 'separate');
assert.throws(() => groupingPolicy({}, [], variants), /could not be verified/);
assert.deepEqual(allocateQuantities(37, variants, 'export'), [37, 37]);
assert.deepEqual(allocateQuantities(37, variants, 'shared'), [37, 9]);
assert.deepEqual(allocateQuantities(753, [{ sku: 'TEST-12PC', uomQty: 12 }], 'shared'), [62]);
assert.deepEqual(allocateQuantities(0, variants, 'export'), [0, 0]);
const split = allocateQuantities(37, variants);
assert.equal(split[0] + split[1] * 4, 37);
assert.throws(() => assertVariantIdentity({ ebayId: 'live' }, variants), /migration/);
assert.throws(() => assertVariantIdentity({ ebayListing: { variants } }, variants.slice(0, 1)), /rules changed/);
assertVariantIdentity({}, variants);
assert.equal(listingTargets({ ebayListing: { variants } }).length, 2);

const filename = path.resolve(__dirname, '../server.js');
const source = fs.readFileSync(filename, 'utf8');
const context = {
  require: createRequire(filename), console,
  systemProductVariants: () => variants,
  productSellingUnits: () => ({ explicit: false, individual: true, cases: true, sourceQty: 4 }),
  ebayListingConfig: () => config,
  ebayEffectiveSettings: () => ({ productSettings: {}, effectiveSettings: { ebayPriceMarkupPercent: 30 } }),
  productUsesSellUnitPricing: () => false, productUomQty: () => 4,
  findChannelByName: () => ({ name: 'eBay' }),
  shopifyVariantPriceBasis: (_, variant) => 5 * variant.uomQty,
  marketplaceBaseSellPrice: () => 5,
  applyPricePolicy: require('../lib/channel-price-policy').applyPricePolicy,
  calculateChannelPrice: require('../lib/channel-price-formula').calculateChannelPrice,
  marketplaceItemCost: () => 5,
};
const config = { marketplaceId: 'EBAY_US', categoryId: '123', merchantSku: 'TEST', format: 'FIXED_PRICE', quantity: 37, price: 26, inventoryConnected: true, aspects: {}, currency: 'USD', listingDescription: 'Test description' };
vm.createContext(context);
function load(start, end) { vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), context); }
load('function marketplaceSuggestedPrice(', 'function marketplaceListingQuantity(');
load('function ebayPurchaseUnitPlan(', 'async function ebayListingReadiness(');
const product = { id: 'test', sku: 'TEST', title: 'Test', cost: 5 };
const plan = context.ebayPurchaseUnitPlan({}, product, {}, config);
assert.deepEqual(Array.from(plan.variants, row => row.price), [6.5, 26]);
assert.deepEqual(Array.from(plan.variants, row => row.quantity), [37, 37]);
assert.deepEqual(Array.from(context.ebayPurchaseUnitPlan({}, product, {}, { ...config, quantity: 0 }).variants, row => row.quantity), [0, 0]);
assert.deepEqual(Array.from(context.ebayPurchaseUnitPlan({}, product, {}, { ...config, shippingInventoryBlocked: true }).variants, row => row.quantity), [0, 0]);
assert.throws(() => context.ebayPurchaseUnitPlan({}, product, { price: 1 }, config), /ambiguous/);
context.productUsesSellUnitPricing = () => true;
context.shopifyVariantPriceBasis = (_, row) => 5 * row.uomQty / 4;
const sellUnitPlan = context.ebayPurchaseUnitPlan({}, { ...product, minimumAllowedPrice: 8 }, {}, config);
assert.deepEqual(Array.from(sellUnitPlan.variants, row => row.price), [2, 8]);
context.productUsesSellUnitPricing = () => false;
context.shopifyVariantPriceBasis = (_, row) => 5.37 * row.uomQty;
context.ebayEffectiveSettings = () => ({ productSettings: {}, effectiveSettings: { ebayPriceMarkupPercent: 30, ebayRoundingRule: 'nearest .95' } });
const bulbPlan = context.ebayPurchaseUnitPlan({}, { ...product, minimumAllowedPrice: 5.26 }, {}, config);
assert.deepEqual(Array.from(bulbPlan.variants, row => row.price), [6.95, 27.95], 'Individual and case calculations use their respective cost and source minimum');
const protectedPlan = context.ebayPurchaseUnitPlan({}, { ...product, minimumAllowedPrice: 7.02 }, {}, config);
assert.deepEqual(Array.from(protectedPlan.variants, row => row.price), [7.02, 28.08], 'Minimum allowed price is applied after .95 rounding and never undercut');
context.ebayEffectiveSettings = () => ({ productSettings: {}, effectiveSettings: { ebayPriceMarkupPercent: 30 } });
context.shopifyVariantPriceBasis = (_, row) => 5 * row.uomQty;

load('async function createOrUpdateEbayPurchaseUnits(', 'async function createOrUpdateEbayListing(');
load('async function syncEbayPurchaseUnits(', 'async function runEbayPriceInventorySyncWorkerJob(');
let calls = [], checkpoints = [];
Object.assign(context, {
  ebayPurchaseUnitGrouping: async (_, item, cfg, units) => ({ ...units, mode: 'group', groupKey: 'test-group', aspectName: 'Number in Pack', values: ['1', '4'] }),
  validateEbayListingConfig: () => [],
  assignProductEbayListing: (item, listing) => (item.ebayListing = listing),
  ebayListingUrl: id => `https://www.ebay.com/itm/${id}`,
  ebayProductImageUrls: () => ['https://example.com/product.jpg'],
  ebayPublishBlockDetails: error => ({ publishError: error.message }),
  postgres: { isPostgresEnabled: () => true, readProductsByKeys: async () => [], upsertProductsFromState: async items => checkpoints.push(JSON.parse(JSON.stringify(items))) },
  skuMatchesProduct: (item, sku) => item.sku === sku,
  addProductAlias: () => {},
  createOrUpdateEbayListing: async (_, child, body, options) => {
    assert.equal(options.publish, false);
    child.ebayListing = { ...child.ebayListing, ...options.purchaseUnitConfig, offerId: child.sku, status: child.ebayListing.listingId ? 'published' : 'offer' };
  },
  ebayRequest: async (_, route, options) => { calls.push({ route, options }); return { listingId: 'live-group' }; },
  productIsMasterInactive: item => item.active === false,
  ebayInventoryApiSkuMissing: errors => errors.some(row => row.errorId === 25604),
});

(async () => {
  let item = { ...product };
  await context.createOrUpdateEbayPurchaseUnits({}, item, {}, { publish: false }, config, structuredClone(plan));
  assert.equal(calls.filter(row => /publish/.test(row.route)).length, 0);
  assert.equal(item.ebayListing.variants.length, 2);
  assert.equal(checkpoints[0][0].ebayListing.variants[0].offerId, 'TEST');
  calls = [];
  await context.createOrUpdateEbayPurchaseUnits({}, item, {}, { publish: true }, config, context.ebayPurchaseUnitPlan({}, item, {}, config));
  assert.equal(calls.filter(row => /publish_by_inventory_item_group/.test(row.route)).length, 1);
  assert.equal(item.ebayListing.variants[1].listingId, 'live-group');
  assert.equal(calls.find(row => row.route.includes('/inventory_item_group/')).options.body.variantSKUs.length, 2);
  calls = [];
  await context.createOrUpdateEbayPurchaseUnits({}, item, {}, { publish: true }, config, context.ebayPurchaseUnitPlan({}, item, {}, config));
  assert.equal(calls.filter(row => /publish/.test(row.route)).length, 0, 'Retry must not republish confirmed live children');
  context.ebayPurchaseUnitGrouping = async (_, item, cfg, units) => ({ ...units, mode: 'separate', groupKey: '' });
  let failPack = true;
  context.ebayRequest = async (_, route) => {
    calls.push({ route });
    if (route.includes('4PC') && failPack) throw new Error('Pack rejected');
    return { listingId: route.includes('4PC') ? 'pack-live' : 'each-live' };
  };
  item = { ...product };
  await assert.rejects(context.createOrUpdateEbayPurchaseUnits({}, item, {}, { publish: true }, config, structuredClone(plan)), /Pack rejected/);
  assert.equal(item.ebayListing.status, 'partially_published');
  assert.equal(item.ebayListing.variants[1].offerId, 'TEST-4PC');
  failPack = false; calls = [];
  await context.createOrUpdateEbayPurchaseUnits({}, item, {}, { publish: true }, config, context.ebayPurchaseUnitPlan({}, item, {}, config));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].route.includes('4PC'));

  let requests = [];
  context.ebayBulkUpdatePriceQuantity = async (_, batch) => {
    requests.push(...batch.map(row => row.request));
    return { responses: batch.map(row => ({ sku: row.request.sku, statusCode: 200 })) };
  };
  item.active = false;
  await context.syncEbayPurchaseUnits({}, item, { updatePrice: true, updateInventory: true });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.shipToLocationAvailability.quantity, 0);
    assert.equal(request.offers[0].availableQuantity, 0);
    assert.equal(request.offers[0].price, undefined);
  }
  item.active = true;
  context.ebayBulkUpdatePriceQuantity = async () => ({ responses: [] });
  const failed = await context.syncEbayPurchaseUnits({}, item, { updatePrice: true, updateInventory: true });
  assert.equal(failed.errors.length, 2, 'Missing response is never success');
  assert.equal(item.ebayListing.variants[0].quantity, 0, 'Failed sync retains last acknowledged quantity');
  context.productSellingUnits = () => ({ explicit: true, individual: false, cases: true, sourceQty: 4 });
  const restricted = context.ebayPurchaseUnitPlan({}, item, {}, config, { syncOnly: true });
  assert.equal(restricted.variants.find(row => row.sku === 'TEST').quantity, 0);
  assert.equal(restricted.variants.find(row => row.sku === 'TEST-4PC').quantity, 9);
  assert.equal(restricted.stockAllocation, 'shared');
  context.systemProductVariants = () => [{ sku: 'TEST-4PC', uomQty: 4 }];
  const supplierUomPlan = context.ebayPurchaseUnitPlan({}, { ...product, uomQty: 4 }, {}, config);
  assert.equal(supplierUomPlan.variants.length, 1);
  assert.equal(supplierUomPlan.variants[0].quantity, 9);
  assert.equal(supplierUomPlan.stockAllocation, 'shared');
  context.productSellingUnits = () => ({ explicit: false, individual: true, cases: true, sourceQty: 4 });
  load('function inventorySkuCandidates(', 'function skuMatchesInventoryItem(');
  context.orderSkuBaseFromUomVariant = sku => sku.replace(/-\d+PC$/, '');
  assert.equal(context.inventorySkuMatch('TEST-4PC', item).multiplier, 4);
  assert.equal(4 * context.inventorySkuMatch('TEST-4PC', item).multiplier, 16, 'An order for four four-packs consumes sixteen individual units');
  assert.equal(context.inventorySkuMatch('TEST', item).multiplier, 1);
  context.systemProductVariants = () => [{ sku: 'TEST', uomQty: 4 }];
  assert.equal(context.ebayPurchaseUnitPlan({}, product, {}, config), null, 'UOM-only suppliers retain the single-listing path');
  assert.throws(() => context.ebayPurchaseUnitPlan({}, item, {}, config), /rules changed/, 'Changing vendor rules must not orphan live children');
  console.log('eBay purchase-unit planning, pricing, grouping, checkpoint/retry and zero-inventory tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
