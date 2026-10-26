const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { tiktokSignature } = require('../lib/tiktok-client');
const { createTikTokCredentials } = require('../lib/tiktok-credentials');
const { componentRows, mapTikTokOrder, mapTikTokReturn } = require('../lib/tiktok-mappers');

async function main() {
  const signature = tiktokSignature('/order/202309/orders/search', {
    timestamp: '1700000000',
    app_key: 'app-key',
    shop_cipher: 'shop-cipher',
    sign: 'ignored'
  }, '{"page_size":10}', 'app-secret');
  assert.equal(signature, '4023fdd397c99ee51950d7287dc195e2835f56a3ea6f7c8ea3bff1b65435231f');

  const directory = fs.mkdtempSync(path.join(process.env.DATAPLUS_TEST_TMP_DIR || os.tmpdir(), 'dataplus-tiktok-'));
  try {
    const env = { DATAPLUS_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
    const credentials = createTikTokCredentials({ directory, env });
    credentials.save('production', {
      appKey: 'app-key', appSecret: 'app-secret', accessToken: 'access-token', refreshToken: 'refresh-token'
    });
    const savedText = fs.readFileSync(path.join(directory, 'tiktok-runtime-credentials.json'), 'utf8');
    assert.equal(savedText.includes('app-secret'), false);
    assert.equal(savedText.includes('access-token'), false);
    assert.equal(credentials.get('production').refreshToken, 'refresh-token');
    credentials.updateTokens('production', { access_token: 'next-access', expires_in: 3600 });
    assert.equal(credentials.get('production').accessToken, 'next-access');
    assert.equal(credentials.fingerprint('production'), credentials.fingerprint('production'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

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

  console.log('TikTok Shop integration tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
