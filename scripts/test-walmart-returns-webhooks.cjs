const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { walmartReturnRows, walmartReturnNextCursor, walmartReturnRecord } = require('../lib/walmart-returns');
const { verifyWalmartWebhook, walmartWebhookEnvelope, walmartWebhookEventTypes, walmartWebhookSubscriptionRows, sanitizeWalmartSubscriptions } = require('../lib/walmart-webhooks');
const { walmartCancelableLines, walmartCancellationPayload } = require('../lib/walmart-operations');
const { createWalmartCredentials } = require('../lib/walmart-credentials');
const { mapOrder } = require('../lib/walmart-client');
const { supportsTask } = require('../lib/worker-lanes');

function run() {
  const rawReturn = {
    returnOrderId: 'RMA-123',
    returnOrderDate: '2026-10-20T12:00:00Z',
    totalRefundAmount: { currencyAmount: 24.5, currencyUnit: 'USD' },
    returnOrderLines: [{
      returnOrderLineNumber: '1',
      purchaseOrderId: 'PO-123',
      purchaseOrderLineNumber: '2',
      item: { sku: 'REMOTE-SKU', productName: 'Remote title' },
      quantity: { measurementValue: 1 },
      status: 'COMPLETED',
      currentRefundStatus: 'REFUND_ISSUED',
      returnReason: 'DAMAGED',
      returnTrackingDetail: [{ eventTag: 'REFUND_ISSUED' }]
    }],
    returnLineGroups: [{ labels: [{ labelImageURL: 'https://example.test/label.pdf', carrierInfoList: [{ trackingNo: '1Z123', carrierName: 'UPS', serviceType: 'Ground' }] }] }]
  };
  assert.deepEqual(walmartReturnRows({ returnOrders: { returnOrder: [rawReturn] } }), [rawReturn]);
  assert.deepEqual(walmartReturnRows({ payload: { returnOrders: { returnOrder: [rawReturn] } } }), [rawReturn]);
  assert.equal(walmartReturnNextCursor({ meta: { nextCursor: '?limit=100&next=abc' } }), '?limit=100&next=abc');
  assert.throws(() => walmartReturnNextCursor({ nextCursor: 'https://attacker.test/' }), /invalid return cursor/i);
  const mapped = walmartReturnRecord(rawReturn, { id: 'ORDER-1', orderNumber: '1001', currency: 'USD', items: [{ id: 'line-2', sourceLineId: '2', sku: 'LOCAL-SKU', title: 'Local title' }] });
  assert.equal(mapped.orderId, 'ORDER-1');
  assert.equal(mapped.purchaseOrderId, 'PO-123');
  assert.equal(mapped.channelOrderId, 'PO-123');
  assert.equal(mapped.returnNumber, '');
  assert.equal(mapped.channelReturnReference, 'RMA-123');
  assert.equal(mapped.status, 'completed');
  assert.equal(mapped.actualRefundAmount, 24.5);
  assert.equal(mapped.items[0].sku, 'LOCAL-SKU');
  assert.equal(mapped.returnTracking[0].trackingNumber, '1Z123');
  const canceledOrder = mapOrder({ purchaseOrderId: 'PO-CANCEL', customerOrderId: 'CUSTOMER-1', orderDate: '2026-10-20T12:00:00Z', orderLines: { orderLine: [{ lineNumber: '1', item: { sku: 'SKU-1', productName: 'Item' }, orderLineQuantity: { amount: '1' }, charges: { charge: [{ chargeType: 'PRODUCT', chargeAmount: { amount: 10, currency: 'USD' } }] }, orderLineStatuses: { orderLineStatus: [{ status: 'CANCELLED', statusQuantity: { amount: '1' } }] } }] } });
  assert.equal(canceledOrder.status, 'canceled');
  assert.equal(canceledOrder.items[0].remainingQty, 0);

  const payload = { source: { eventType: 'ORDER_UPDATES', eventId: 'event-1' }, payload: { meta: { subEventType: 'INTENT_TO_CANCEL' }, order: { purchaseOrderId: 'PO-123' } } };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const secret = 'test-webhook-secret';
  const hex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const base64 = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  assert.equal(verifyWalmartWebhook(rawBody, hex, secret), true);
  assert.equal(verifyWalmartWebhook(rawBody, `sha256=${base64}`, secret), true);
  assert.equal(verifyWalmartWebhook(rawBody, hex, 'wrong-secret'), false);
  const envelope = walmartWebhookEnvelope(payload, rawBody);
  assert.equal(envelope.supported, true);
  assert.equal(envelope.subEventType, 'INTENT_TO_CANCEL');
  assert.deepEqual(envelope.purchaseOrderIds, ['PO-123']);
  assert.deepEqual(walmartWebhookEventTypes({ eventTypes: { eventType: [
    { eventType: 'ORDER_UPDATES', eventVersion: 'V1', resourceName: 'ORDER' },
    { eventType: 'PO_CREATED', eventVersion: 'V1', resourceName: 'ORDER' },
    { eventType: 'RETURN_CREATED', eventVersion: 'V1', resourceName: 'RETURN' }
  ] } }).map(row => row.eventType), ['ORDER_UPDATES', 'RETURN_CREATED']);
  assert.deepEqual(walmartWebhookEventTypes({ eventTypes: [
    { eventType: 'PO_CREATED', eventVersion: 'V1', resourceName: 'ORDER' },
    { eventType: 'RETURN_INVOICED', eventVersion: 'V1', resourceName: 'RETURN' }
  ] }).map(row => row.eventType), ['PO_CREATED', 'RETURN_INVOICED']);
  assert.deepEqual(sanitizeWalmartSubscriptions({ id: '1', authHeaderValue: 'secret', nested: { token: 'secret', status: 'ACTIVE' } }), { id: '1', nested: { status: 'ACTIVE' } });
  assert.deepEqual(walmartWebhookSubscriptionRows({ events: [{ eventType: 'RETURN_CREATED', eventUrl: 'https://example.test/webhook', status: 'ACTIVE', subscriptionId: 'sub-1' }] }), [{ eventType: 'RETURN_CREATED', eventUrl: 'https://example.test/webhook', status: 'ACTIVE', subscriptionId: 'sub-1' }]);

  const remoteOrder = { orderLines: { orderLine: [
    { lineNumber: '1', item: { sku: 'SKU-1' }, orderLineQuantity: { unitOfMeasurement: 'EACH' }, orderLineStatuses: { orderLineStatus: [{ status: 'ACKNOWLEDGED', statusQuantity: { amount: '2' } }] } },
    { lineNumber: '2', item: { sku: 'SKU-2' }, orderLineQuantity: { unitOfMeasurement: 'EACH' }, orderLineStatuses: { orderLineStatus: [{ status: 'Shipped', statusQuantity: { amount: '1' } }] } }
  ] } };
  assert.equal(walmartCancelableLines(remoteOrder)[0].cancellableQuantity, 2);
  const cancellation = walmartCancellationPayload(remoteOrder, [{ lineNumber: '1', quantity: 1 }], 'CUSTOMER_REQUESTED_SELLER_TO_CANCEL');
  assert.equal(cancellation.orderCancellation.orderLines.orderLine[0].orderLineStatuses.orderLineStatus[0].statusQuantity.amount, '1');
  assert.throws(() => walmartCancellationPayload(remoteOrder, [{ lineNumber: '2', quantity: 1 }], 'CUSTOMER_REQUESTED_SELLER_TO_CANCEL'), /only 0 cancellable/i);
  assert.throws(() => walmartCancelableLines({ fulfillmentOption: 'WFS', orderLines: { orderLine: [] } }), /Fulfillment Services/i);

  const testRoot = path.join(process.cwd(), 'outputs');
  fs.mkdirSync(testRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(testRoot, '.test-walmart-credentials-'));
  try {
    const credentials = createWalmartCredentials({ directory, env: {} });
    credentials.save('production', { clientId: 'client', clientSecret: 'secret', channelType: 'direct' });
    const webhookSecret = credentials.ensureWebhookSecret('production');
    assert.equal(webhookSecret.length >= 32, true);
    assert.equal(credentials.webhookSecret('production'), webhookSecret);
    assert.equal(credentials.status('production').webhookSecretConfigured, true);
    assert.equal(Object.hasOwn(credentials.status('production'), 'webhookSecret'), false);
    credentials.save('production', { clientId: 'client', clientSecret: '', channelType: 'direct' });
    assert.equal(credentials.webhookSecret('production'), webhookSecret);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const marketplace = fs.readFileSync(path.join(__dirname, '..', 'lib', 'walmart-marketplace.js'), 'utf8');
  assert.match(server, /POST['"]\s*&&\s*url\.pathname\s*===\s*['"]\/api\/webhooks\/walmart['"]/);
  assert.match(server, /return sendJson\(res, 200, result\)/);
  assert.match(marketplace, /process\.env\.WALMART_WEBHOOK_URL/);
  assert.match(marketplace, /event type is not configured/i);
  assert.doesNotMatch(marketplace, /if \(event\.supported\) await queue\('webhook'/);
  assert.match(marketplace, /if \(event\.supported\)[\s\S]{0,120}queue\('webhook',[\s\S]{0,120}\.catch\(/);
  assert.equal(supportsTask('walmart', 'walmart-returns'), true);
  assert.equal(supportsTask('walmart', 'walmart-webhook'), true);
  console.log('Walmart returns, cancellation, webhook, and credential tests passed.');
}

run();
