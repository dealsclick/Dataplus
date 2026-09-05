const test = require('node:test');
const assert = require('node:assert/strict');
const { ebayReturnEnvelope, returnNeedsAttention, reconcileOrderReturns, validateReturnReceipt } = require('../lib/return-workflow');
const { normalizeSourceOrderCompletion } = require('../lib/source-order-completion');
const { collectPages } = require('../lib/shopify-return-import');

test('eBay detail keeps header, actual refund, specific item and deduplicated return tracking', () => {
  const data = ebayReturnEnvelope({}, {
    summary: { returnId: 'R1', state: 'CLOSED', sellerTotalRefund: { actualRefundAmount: { value: 10 }, estimatedRefundAmount: { value: 12 } }, creationInfo: { item: { itemId: 'I', transactionId: 'T', returnQuantity: 1 } } },
    detail: { returnShipmentInfo: { shipmentTracking: { trackingNumber: 'ABC', carrierName: 'USPS' }, allShipmentTrackings: [{ trackingNumber: 'ABC', carrierName: 'USPS' }] } }
  });
  assert.equal(data.returnId, 'R1'); assert.equal(data.state, 'CLOSED');
  assert.equal(data.actualRefundAmount.value, 10); assert.equal(data.estimatedRefundAmount.value, 12);
  assert.equal(data.item.transactionId, 'T'); assert.equal(data.returnTracking.length, 1);
});
test('estimated refunds are not confirmed refunds', () => {
  const data = ebayReturnEnvelope({ sellerTotalRefund: { estimatedRefundAmount: { value: 12 } } });
  assert.equal(data.actualRefundAmount, undefined);
});
test('closed channel return does not imply warehouse receipt or attention', () => {
  assert.equal(returnNeedsAttention({ status: 'requested', channelLifecycleStatus: 'closed' }), false);
  assert.equal(returnNeedsAttention({ status: 'closed', channelLifecycleStatus: 'closed', receivingStatus: 'inspection' }), true);
  assert.equal(returnNeedsAttention({ status: 'done', channelLifecycleStatus: 'requested', receivingStatus: 'done' }), true);
});
test('reconcile opening and closing a return updates queue without deleting unrelated exceptions', () => {
  const order = { id: 'O', orderNumber: '1', fulfillmentStatus: 'FULFILLED', workflowExceptions: [{ id: 'old', type: 'info', severity: 'warning', status: 'open' }] };
  const record = { id: 'R', orderId: 'O', channelLifecycleStatus: 'requested', status: 'requested' };
  reconcileOrderReturns(order, [record]); normalizeSourceOrderCompletion(order);
  assert.equal(order.operationalStatus, 'on_hold');
  record.channelLifecycleStatus = 'closed'; record.status = 'closed';
  reconcileOrderReturns(order, [record]); normalizeSourceOrderCompletion(order);
  assert.equal(order.operationalStatus, 'completed');
  assert.equal(order.workflowExceptions[0].id, 'old');
  assert.equal(order.returns.length, 1);
});
const warehouse = [{ id: 'W', active: true }];
const record = { items: [{ sku: 'SKU', qty: 2 }], warehouseId: 'W' };
test('receipt rejects missing, excessive, negative and fractional received quantities', () => {
  for (const qty of [0, 3, -1, 0.5, NaN]) assert.ok(validateReturnReceipt(record, { status: 'received', items: [{ sku: 'SKU', qty: 2, receivedQty: qty }] }, warehouse));
});
test('restocking requires passed inspection and active destination', () => {
  const body = { status: 'done', disposition: 'restock', items: [{ sku: 'SKU', qty: 2, receivedQty: 2 }] };
  assert.match(validateReturnReceipt(record, body, warehouse), /inspection/);
  assert.equal(validateReturnReceipt(record, { ...body, inspectionStatus: 'passed' }, warehouse), '');
  assert.ok(validateReturnReceipt(record, { ...body, inspectionStatus: 'passed' }, [{ id: 'W', active: false }]));
});
test('Shopify pagination fetches all pages and rejects repeated cursors', async () => {
  const values = await collectPages(async (after) => ({ nodes: after ? [2] : [1], pageInfo: { hasNextPage: !after, endCursor: 'next' } }));
  assert.deepEqual(values, [1, 2]);
  await assert.rejects(collectPages(async () => ({ nodes: [], pageInfo: { hasNextPage: true, endCursor: 'same' } })), /advance/);
});
