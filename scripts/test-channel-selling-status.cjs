const assert = require('node:assert/strict');
const { SUPPORTED_CHANNELS, channelKey, productChannelInactive, setProductChannelStatus } = require('../lib/channel-selling-status');
const { inventoryAmount } = require('../lib/walmart-operations');

const product = { id: 'p1', sku: 'SKU-1', active: true, qty: 25 };
setProductChannelStatus(product, ['eBay', 'TikTok Shop'], 'inactive', { updatedBy: 'Tester', reason: 'Channel pause', updatedAt: '2026-09-28T12:00:00.000Z' });
assert.equal(productChannelInactive(product, 'ebay'), true);
assert.equal(productChannelInactive(product, 'tiktok'), true);
assert.equal(productChannelInactive(product, 'shopify'), false);
assert.equal(product.channelSellingStatus.ebay.reason, 'Channel pause');
assert.equal(channelKey('TikTok Shop'), 'tiktok');
assert.deepEqual(SUPPORTED_CHANNELS, ['shopify', 'ebay', 'walmart', 'temu', 'whatnot', 'tiktok']);

setProductChannelStatus(product, ['eBay'], 'active', { updatedBy: 'Tester' });
assert.equal(productChannelInactive(product, 'ebay'), false);
assert.equal(productChannelInactive(product, 'tiktok'), true, 'reactivating one channel must preserve other channel blocks');

const walmartProduct = {
  ...product,
  channelSellingStatus: { walmart: { status: 'inactive', inactive: true } },
  warehouseStock: [{ warehouseId: 'w1', qty: 25, reserved: 0, isSellable: true }]
};
const db = { vendors: [], warehouses: [{ id: 'w1', active: true, isPhysical: true }] };
assert.equal(inventoryAmount(walmartProduct, db, { walmartWarehouseId: 'w1' }, 1), 0);
assert.equal(walmartProduct.qty, 25, 'channel inactivity must not mutate local inventory');

console.log('Channel selling status tests passed.');
