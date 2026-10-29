const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { tiktokSignature } = require('../lib/tiktok-client');
const { createTikTokCredentials } = require('../lib/tiktok-credentials');
const { exchangeAuthorizationCode, isTikTokAuthorizationCallbackUrl, sellerAuthorizationUrl } = require('../lib/tiktok-oauth');
const { componentRows, mapTikTokOrder, mapTikTokReturn } = require('../lib/tiktok-mappers');
const { EVENT_TOPICS, reconcileOperation, verifyTikTokShopWebhook, webhookEntity, webhookIdentity, webhookTopic } = require('../lib/tiktok-webhooks');
const {
  applyTikTokLiveAttribution,
  normalizeTikTokLiveAttribution,
  normalizeTikTokLiveProduct,
  normalizeTikTokLiveSession,
  summarizeTikTokLiveSessions
} = require('../lib/tiktok-live');

async function main() {
  const signature = tiktokSignature('/order/202309/orders/search', {
    timestamp: '1700000000',
    app_key: 'app-key',
    shop_cipher: 'shop-cipher',
    sign: 'ignored'
  }, '{"page_size":10}', 'app-secret');
  assert.equal(signature, '4023fdd397c99ee51950d7287dc195e2835f56a3ea6f7c8ea3bff1b65435231f');

  const webhookBody = Buffer.from(JSON.stringify({ event_id: 'event-1', event_type: 'ORDER_STATUS_CHANGE', data: { order_id: '576000001' } }));
  const webhookAuthorization = require('node:crypto').createHmac('sha256', 'app-secret').update(Buffer.concat([Buffer.from('app-key'), webhookBody])).digest('hex');
  assert.equal(verifyTikTokShopWebhook(webhookBody, webhookAuthorization, 'app-key', 'app-secret'), true);
  assert.equal(verifyTikTokShopWebhook(webhookBody, `sha256=${webhookAuthorization}`, 'app-key', 'app-secret'), true);
  assert.equal(verifyTikTokShopWebhook(webhookBody, `${webhookAuthorization}bad`, 'app-key', 'app-secret'), false);
  assert.equal(webhookIdentity(JSON.parse(webhookBody), webhookBody), 'event-1');
  assert.equal(webhookTopic(JSON.parse(webhookBody)), 'ORDER_STATUS_CHANGE');
  assert.equal(webhookEntity(JSON.parse(webhookBody)).orderId, '576000001');
  assert.equal(reconcileOperation('RETURN_STATUS_CHANGE'), 'returns');
  assert.equal(reconcileOperation('NEW_MESSAGE'), 'messages');
  assert.equal(webhookTopic({ type: 71, data: { product_id: 'product-1', sku_id: 'sku-1' } }), 'INVENTORY_CHANGED_BY_SHOP');
  assert.equal(EVENT_TOPICS.includes('NEW_MESSAGE'), true);

  const directory = fs.mkdtempSync(path.join(process.env.DATAPLUS_TEST_TMP_DIR || os.tmpdir(), 'dataplus-tiktok-'));
  try {
    const env = { DATAPLUS_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
    const credentials = createTikTokCredentials({ directory, env });
    credentials.save('development', {
      appKey: 'development-app-key', appSecret: 'development-app-secret'
    });
    assert.equal(credentials.status('development').appSecretConfigured, true);
    assert.equal(credentials.status('development').appConfigured, false);
    assert.throws(() => credentials.beginAuthorization('development'), /Service ID/);
    credentials.save('production', {
      appKey: 'app-key', appSecret: 'app-secret', serviceId: 'service-id'
    });
    const savedText = fs.readFileSync(path.join(directory, 'tiktok-runtime-credentials.json'), 'utf8');
    assert.equal(savedText.includes('app-secret'), false);
    assert.equal(savedText.includes('access-token'), false);
    assert.equal(credentials.status('production').appConfigured, true);
    assert.equal(credentials.status('production').configured, false);
    const sessionToken = 'signed-in-dataplus-session';
    const authorization = credentials.beginAuthorization('production', { actorId: 'user-1', actorName: 'Luis', returnTo: '/channels?channel=TikTok%20Shop', sessionToken });
    const parallelAuthorization = credentials.beginAuthorization('production', { actorId: 'user-1', actorName: 'Luis', returnTo: '/channels?channel=TikTok%20Shop&tab=sync', sessionToken });
    assert.match(authorization.state, /^production\.v2\./);
    assert.ok(authorization.state.length < 512);
    assert.equal(credentials.status('production').authorizationPending, true);
    assert.throws(() => credentials.consumeAuthorization('production.invalid', { sessionToken }), /invalid or expired/);
    assert.throws(() => credentials.consumeAuthorization(authorization.state, { sessionToken: 'another-session' }), /did not match this DataPlus session/);
    const consumed = credentials.consumeAuthorization(authorization.state, { sessionToken });
    assert.equal(consumed.environment, 'production');
    assert.equal(consumed.actorId, 'user-1');
    assert.equal(consumed.actorName, 'Luis');
    assert.throws(() => credentials.consumeAuthorization(authorization.state, { sessionToken }), /invalid or expired/);
    assert.equal(credentials.consumeAuthorization(parallelAuthorization.state, { sessionToken }).returnTo, '/channels?channel=TikTok%20Shop&tab=sync');
    credentials.updateTokens('production', { access_token: 'next-access', refresh_token: 'refresh-token', expires_in: 3600, user_type: 0 });
    assert.equal(credentials.get('production').accessToken, 'next-access');
    assert.equal(credentials.get('production').refreshToken, 'refresh-token');
    assert.equal(credentials.status('production').configured, true);
    assert.equal(credentials.fingerprint('production'), credentials.fingerprint('production'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  const sellerUrl = new URL(sellerAuthorizationUrl({ serviceId: 'service-id', state: 'production.state', region: 'US' }));
  assert.equal(sellerUrl.origin, 'https://services.us.tiktokshop.com');
  assert.equal(sellerUrl.pathname, '/open/authorize');
  assert.equal(sellerUrl.searchParams.get('service_id'), 'service-id');
  assert.equal(sellerUrl.searchParams.get('state'), 'production.state');
  assert.equal(isTikTokAuthorizationCallbackUrl('/auth/tiktok/callback?code=auth-code&state=production.state'), true);
  assert.equal(isTikTokAuthorizationCallbackUrl('/?auth_code=auth-code&state=production.v2.payload.signature'), true);
  assert.equal(isTikTokAuthorizationCallbackUrl('/?error=access_denied&state=development.v2.payload.signature'), true);
  assert.equal(isTikTokAuthorizationCallbackUrl('/?auth_code=auth-code&state=production.legacy-state'), true);
  assert.equal(isTikTokAuthorizationCallbackUrl('/?code=auth-code&state=ebay-state'), false);
  assert.equal(isTikTokAuthorizationCallbackUrl('/auth/ebay/callback?code=auth-code&state=production.state'), false);
  const exchanged = await exchangeAuthorizationCode({
    appKey: 'app-key', appSecret: 'app-secret', authCode: 'auth-code',
    fetchImpl: async url => {
      const requestUrl = new URL(url);
      assert.equal(requestUrl.searchParams.get('grant_type'), 'authorized_code');
      assert.equal(requestUrl.searchParams.get('auth_code'), 'auth-code');
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { access_token: 'generated-access', refresh_token: 'generated-refresh', user_type: 0, granted_scopes: 'seller.order,seller.product' } }) };
    }
  });
  assert.equal(exchanged.access_token, 'generated-access');
  assert.deepEqual(exchanged.granted_scopes, ['seller.order', 'seller.product']);
  await assert.rejects(exchangeAuthorizationCode({
    appKey: 'app-key', appSecret: 'app-secret', authCode: 'creator-code',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: { access_token: 'creator-access', refresh_token: 'creator-refresh', user_type: 1 } }) })
  }), /non-seller token/);

  const rawOrder = {
    id: '576000001', status: 'AWAITING_SHIPMENT', create_time: 1700000000, update_time: 1700000100,
    recipient_address: { name: 'Customer', address_line1: '1 Main St', post_town: 'Seattle', postal_code: '98101', region_code: 'US', district_info: [{ address_level_name: 'State', address_name: 'WA' }] },
    payment: { total_amount: '30.00', sub_total: '28.00', shipping_fee: '2.00', currency: 'USD' },
    line_items: [
      { id: 'line-1', seller_sku: 'SKU-1', product_name: 'First', quantity: 2, sale_price: '5.00', combined_listing_skus: [{ seller_sku: 'COMPONENT-1', sku_count: 4 }] },
      { id: 'line-2', seller_sku: 'SKU-2', product_name: 'Second', sale_price: '18.00' }
    ]
  };
  const order = mapTikTokOrder(rawOrder);
  assert.equal(order.items.length, 2);
  assert.equal(order.marketplaceOrderId, '576000001');
  assert.equal(order.source, 'TikTok Shop');
  assert.equal(order.address.postalCode, '98101');
  assert.equal(order.items[0].qty, 2);
  assert.equal(order.items[0].price, 5);
  assert.equal(order.items[0].bundleComponents[0].quantity, 4);

  const returnRecord = mapTikTokReturn({
    return_id: 'return-1', order_id: '576000001', return_status: 'RETURNED', create_time: 1700000200,
    return_line_items: [{ return_line_item_id: 'return-line-1', order_line_item_id: 'line-2', seller_sku: 'SKU-2', return_quantity: 2, refund_amount: { amount: '18.00' } }]
  }, order);
  assert.equal(returnRecord.orderId, order.id);
  assert.equal(returnRecord.items[0].sku, 'SKU-2');
  assert.equal(returnRecord.items[0].qty, 2);
  assert.equal(returnRecord.status, 'completed');
  assert.equal(returnRecord.returnNumber, '');
  assert.equal(returnRecord.channelReturnReference, 'return-1');

  const successfulRequest = mapTikTokReturn({
    return_id: 'return-2', order_id: '576000001', return_status: 'RETURN_OR_REFUND_REQUEST_SUCCESS',
    return_line_items: [{ return_line_item_id: 'return-line-2', order_line_item_id: 'line-1', seller_sku: 'SKU-1' }]
  }, order);
  assert.equal(successfulRequest.status, 'completed');

  const rejectedRequest = mapTikTokReturn({
    return_id: 'return-3', order_id: '576000001', return_status: 'REFUND_OR_RETURN_REQUEST_REJECT',
    return_line_items: [{ return_line_item_id: 'return-line-3', order_line_item_id: 'line-1', seller_sku: 'SKU-1' }]
  }, order);
  assert.equal(rejectedRequest.status, 'canceled');

  const fees = componentRows({
    id: 'txn-1', order_id: '576000001', currency: 'USD',
    fee_tax_breakdown: { fee: { platform_commission: '-2.50' } },
    shipping_cost_breakdown: { shipping_fee: '-7.25' }
  }, 'statement-1');
  assert.equal(fees.length, 2);
  assert.deepEqual(fees.map(row => row.feeAmount).sort((a, b) => a - b), [-7.25, -2.5]);
  assert.equal(fees.every(row => row.netAmount === 0), true);

  const revenueEvidence = componentRows({
    id: 'txn-2', order_id: '576000001', currency: 'USD', type: 'ORDER',
    revenue_amount: '28.00', settlement_amount: '28.00'
  }, 'statement-1');
  assert.equal(revenueEvidence.length, 1);
  assert.equal(revenueEvidence[0].feeType, 'PAYOUT_EVIDENCE');
  assert.equal(revenueEvidence[0].feeAmount, 0);
  assert.equal(revenueEvidence[0].grossAmount, 28);
  assert.equal(revenueEvidence[0].netAmount, 28);

  const adjustment = componentRows({
    id: 'txn-3', adjustment_order_id: '576000001', currency: 'USD', type: 'ADJUSTMENT',
    adjustment_amount: '-4.25', settlement_amount: '-4.25'
  }, 'statement-1');
  assert.equal(adjustment.length, 1);
  assert.equal(adjustment[0].feeType, 'adjustment_amount');
  assert.equal(adjustment[0].feeAmount, -4.25);

  const liveSession = normalizeTikTokLiveSession({
    id: 'live-1', title: 'Weekend hardware show', username: 'creator-one', start_time: 1700000000,
    sales: { gmv: { amount: '125.50', currency: 'USD' }, attributed_sku_orders: 4, attributed_items_sold: 6 },
    traffic: { views: 900, product_clicks: 80 }
  }, 'AFFILIATE_ACCOUNTS');
  assert.equal(liveSession.liveId, 'live-1');
  assert.equal(liveSession.gmv, 125.5);
  assert.equal(liveSession.skuOrders, 4);
  assert.equal(liveSession.views, 900);

  const currentLiveSession = normalizeTikTokLiveSession({
    live_id: 'live-202609', account_type: 'OFFICIAL_ACCOUNTS',
    sales_performance: {
      live_attributed_gmv: { amount: '88.20', currency: 'USD' },
      live_attributed_sku_orders: 3,
      live_attributed_items_sold: 5,
      products_sold: 2
    },
    traffic: { products_added: 7 }
  });
  assert.equal(currentLiveSession.gmv, 88.2);
  assert.equal(currentLiveSession.skuOrders, 3);
  assert.equal(currentLiveSession.itemsSold, 5);
  assert.equal(currentLiveSession.productsAdded, 7);
  assert.equal(currentLiveSession.differentProductsSold, 2);

  const liveProduct = normalizeTikTokLiveProduct({
    product_id: 'product-1', product_name: 'Live product',
    sales: { gmv: { amount: '40.00', currency: 'USD' }, sku_orders: 2 },
    traffic: { product_impressions: 100, product_clicks: 15 }
  });
  assert.equal(liveProduct.productId, 'product-1');
  assert.equal(liveProduct.productClicks, 15);

  const attribution = normalizeTikTokLiveAttribution({
    id: '576000001', status: 'COMPLETED', create_time: 1700000000,
    skus: [
      { product_id: 'product-1', content_type: 'LIVE', content_id: 'live-1', creator_username: 'creator-one', quantity: 2 },
      { product_id: 'product-2', content_type: 'VIDEO', content_id: 'video-1', creator_username: 'creator-two', quantity: 1 }
    ]
  });
  assert.equal(attribution.isLive, true);
  assert.deepEqual(attribution.contentIds, ['live-1']);
  assert.equal(attribution.lines.length, 1);

  const attributedOrder = applyTikTokLiveAttribution({
    ...order,
    items: [{ ...order.items[0], productId: 'product-1' }, { ...order.items[1], productId: 'product-2' }]
  }, attribution);
  assert.equal(attributedOrder.salesOrigin, 'tiktok_live');
  assert.equal(attributedOrder.isTikTokLive, true);
  assert.deepEqual(attributedOrder.tiktokLive.creators, ['creator-one']);
  assert.equal(attributedOrder.items[0].isTikTokLive, true);
  assert.equal(attributedOrder.items[1].isTikTokLive, undefined);

  const liveSummary = summarizeTikTokLiveSessions([liveSession, { ...liveSession, liveId: 'live-2', gmv: 10, skuOrders: 1 }]);
  assert.equal(liveSummary.sessionCount, 2);
  assert.equal(liveSummary.gmv, 135.5);
  assert.equal(liveSummary.skuOrders, 5);

  console.log('TikTok Shop integration tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
