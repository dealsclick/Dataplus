const test = require('node:test');
const assert = require('node:assert/strict');
const { indexSavedTemuReturns, linkSavedTemuReturns } = require('../lib/temu-return-linking');

const order = () => ({ id: 'O', source: 'Temu', orderNumber: '1001', marketplaceOrderNumber: 'PO-123', fulfillmentStatus: 'FULFILLED', items: [{ temuOrderItemId: 'LINE', sku: 'CAT', title: 'Product' }] });
const record = () => ({ id: 'R', source: 'Temu', channelOrderId: 'PO-123', channelLifecycleStatus: 'closed', status: 'closed', note: 'Keep this', amount: null, external: { detail: {} }, items: [{ channelOrderItemId: 'LINE', sku: '', qty: 1, receivedQty: 0 }] });
const options = { save: async value => value, linesForOrder: o => o.items };

test('saved return links to newly imported order and exact line without API data changes', async () => {
  const r = record(), o = order(), index = indexSavedTemuReturns([r]);
  assert.equal(await linkSavedTemuReturns([o], index, options), 1);
  assert.equal(r.orderId, 'O'); assert.equal(r.orderNumber, '1001');
  assert.equal(r.items[0].sku, 'CAT'); assert.equal(r.items[0].receivedQty, 0);
  assert.equal(r.note, 'Keep this'); assert.equal(r.amount, null);
  assert.equal(o.operationalStatus, 'completed'); assert.equal(o.returns.length, 1);
  assert.equal(await linkSavedTemuReturns([o], index, options), 0);
  assert.equal(o.returns.length, 1);
});
test('open saved return puts shipped order into attention and preserves receiving history', async () => {
  const r = { ...record(), channelLifecycleStatus: 'requested', receivingStatus: 'inspection', receivedAt: '2026-09-01', items: [{ channelOrderItemId: 'LINE', sku: 'MANUAL', qty: 1, receivedQty: 1 }] };
  const o = order();
  await linkSavedTemuReturns([o], indexSavedTemuReturns([r]), options);
  assert.equal(o.operationalStatus, 'on_hold'); assert.equal(r.items[0].sku, 'MANUAL');
  assert.equal(r.items[0].receivedQty, 1); assert.equal(r.receivedAt, '2026-09-01');
});
test('different channels, different order references, and existing links are not reassigned', async () => {
  for (const change of [{ source: 'eBay' }, { channelOrderId: 'PO-OTHER' }, { orderId: 'OTHER' }]) {
    const r = { ...record(), ...change };
    assert.equal(await linkSavedTemuReturns([order()], indexSavedTemuReturns([r]), options), 0);
  }
});
test('ambiguous item identity stays unmatched', async () => {
  const o = order(); o.items.push({ ...o.items[0], sku: 'OTHER' });
  const r = record();
  await linkSavedTemuReturns([o], indexSavedTemuReturns([r]), options);
  assert.equal(r.orderId, 'O'); assert.equal(r.items[0].sku, '');
});
