const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewOrder, reviewReturn } = require('../lib/order-data-review');
const order = { id: 'one', orderNumber: '1001', source: 'Temu', marketplaceOrderNumber: 'same-reference', status: 'shipped', operationalStatus: 'completed', shippingCost: 0, trackingNumber: 'TRACK1', shippingCarrier: 'SwiftX', items: [{ sku: 'SKU', qty: 1, fulfillmentStatus: 'fulfilled' }] };
test('healthy shipped records and legitimate shared channel references are not findings', () => {
  assert.deepEqual(reviewOrder(order), []);
  assert.deepEqual(reviewOrder({ ...order, id: 'two', orderNumber: '1002' }), []);
  assert.deepEqual(reviewOrder({ ...order, shipments: [{ status: 'shipped' }] }), []);
});
test('shipping/line inconsistencies are operational; missing costs and tracking are reporting only', () => {
  const before = JSON.stringify(order);
  const result = reviewOrder({ ...order, operationalStatus: 'waiting_for_po', trackingNumber: '', shippingCarrier: '', shippingCost: null, items: [{ sku: 'SKU', qty: 1, fulfillmentStatus: 'unfulfilled' }] });
  assert.deepEqual(result.filter(row => row.category === 'operational').map(row => row.code), ['shipped_outside_done', 'line_fulfillment_mismatch']);
  assert.deepEqual(result.filter(row => row.category === 'reporting').map(row => row.code), ['missing_tracking', 'missing_carrier', 'missing_label_cost']);
  assert.equal(JSON.stringify(order), before);
});
test('unship overrides, cancellations, active returns and genuine blockers do not get a false Done recommendation', () => {
  assert.deepEqual(reviewOrder({ ...order, shipmentCorrection: { active: true } }), []);
  assert.deepEqual(reviewOrder({ ...order, status: 'canceled' }), []);
  assert.ok(!reviewOrder({ ...order, operationalStatus: 'on_hold' }, { returns: [{ status: 'open' }] }).some(row => row.code === 'shipped_outside_done'));
  assert.ok(!reviewOrder({ ...order, operationalStatus: 'on_hold', workflowExceptions: [{ status: 'open', type: 'fraud_review', severity: 'blocking' }] }).some(row => row.code === 'shipped_outside_done'));
});
test('fulfillment quantities reconcile without matching unrelated SKUs or counting canceled packages', () => {
  const line = { ...order, items: [{ sku: 'SKU', qty: 2 }] };
  assert.deepEqual(reviewOrder({ ...line, fulfillmentLines: [{ lineIndex: 0, sku: 'SKU', qtyFulfilled: 2 }] }), []);
  assert.ok(reviewOrder({ ...line, fulfillmentLines: [{ lineIndex: 0, sku: 'WRONG', qtyFulfilled: 2 }] }).some(row => row.code === 'line_fulfillment_mismatch'));
  assert.ok(reviewOrder({ ...line, shipments: [{ status: 'canceled', lines: [{ lineIndex: 0, sku: 'SKU', qtyFulfilled: 2 }] }] }).some(row => row.code === 'line_fulfillment_mismatch'));
  assert.ok(reviewOrder({ ...order, items: [{ ...order.items[0], remainingQty: 1 }] }).some(row => row.code === 'line_fulfillment_mismatch'));
});
test('only active PO links are review candidates; receipt and cancellation history remain untouched', () => {
  const result = reviewOrder(order, { purchaseOrders: [{ id: 'active', status: 'submitted' }, { id: 'old', status: 'canceled' }, { id: 'received', status: 'received' }] });
  assert.equal(result.length, 1); assert.equal(result[0].poId, 'active');
  assert.match(result[0].action, /do not cancel/i);
});
test('unmatched returns are reporting gaps during an unfinished channel import', () => {
  assert.deepEqual(reviewReturn({ id: 'ret' }, true), []);
  const [finding] = reviewReturn({ id: 'ret', source: 'eBay' }, false);
  assert.equal(finding.category, 'reporting'); assert.equal(finding.code, 'unmatched_return'); assert.match(finding.action, /after.*import/);
});
