const assert = require('node:assert/strict');
const { normalizeTikTokLiveSession } = require('../lib/tiktok-live');

const normalized = normalizeTikTokLiveSession({
  id: 'room-1',
  title: 'Tool launch',
  creator: { user_name: 'shopsnap69', open_id: 'creator-1', author_type: 'OFFICIAL_ACCOUNT' },
  start_time: '1795069005',
  sales_performance: {
    live_attributed_gmv: { amount: '123.45', currency: 'USD' },
    live_attributed_orders: 7,
    live_attributed_sku_orders: 9,
    live_attributed_items_sold: 11,
    attributed_customers: 6
  },
  traffic: { viewers: 120, views: 180, product_clicks: 42 },
  interaction_performance: { comments: 8, likes: 90, shares: 4 }
}, 'OFFICIAL_ACCOUNTS');

assert.equal(normalized.liveId, 'room-1');
assert.equal(normalized.creatorUsername, 'shopsnap69');
assert.equal(normalized.gmv, 123.45);
assert.equal(normalized.currency, 'USD');
assert.equal(normalized.mainOrders, 7);
assert.equal(normalized.skuOrders, 9);
assert.equal(normalized.itemsSold, 11);
assert.equal(normalized.viewers, 120);
assert.equal(normalized.comments, 8);
console.log('TikTok LIVE 202609 normalizers passed.');
