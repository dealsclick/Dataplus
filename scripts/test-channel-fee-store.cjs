const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_POLICIES, _test } = require('../lib/channel-fee-store');

test('starter policies stay explicit and Temu does not invent a fee', () => {
  assert.equal(DEFAULT_POLICIES.find(row => row.channel === 'Walmart').percentRate, 15);
  assert.equal(DEFAULT_POLICIES.find(row => row.channel === 'Shopify').fixedFee, 0.30);
  assert.equal(DEFAULT_POLICIES.find(row => row.channel === 'Temu').percentRate, 0);
});

test('settlement CSV parsing preserves quoted commas and signed credits', () => {
  const rows = _test.parseCsv('order_number,fee_amount,description\r\n50001,2.45,"final value, fee"\r\n50002,-0.75,credit\r\n');
  assert.deepEqual(rows, [
    { order_number: '50001', fee_amount: '2.45', description: 'final value, fee' },
    { order_number: '50002', fee_amount: '-0.75', description: 'credit' }
  ]);
  assert.equal(_test.money(rows[0].fee_amount), 2.45);
  assert.equal(_test.money(rows[1].fee_amount), -0.75);
  assert.equal(_test.money('($1,234.56)'), -1234.56);
});

test('Temu detailed reports classify purchases and signed adjustments as shipping expense', () => {
  const rows = _test.normalizeTemuShippingRows([
    { date_time: '2026-08-01 14:08:47', transaction_type: 'Shipping label purchase', related_id: '1Z16E50BYW13196036', order_id: 'PO-211-03511675479672653', total: '-6.22', currency: 'USD' },
    { date_time: '2026-08-03 00:08:55', transaction_type: 'Shipping label purchase adjustment', related_id: '1Z16E50BYW13196036', order_id: 'PO-211-03511675479672653', total: '2.60', currency: 'USD' },
    { date_time: '2026-08-03 00:08:56', transaction_type: 'Shipping label purchase adjustment', related_id: '1Z16E50BYW13196036', order_id: 'PO-211-03511675479672653', total: '-0.55', currency: 'USD' },
    { date_time: '2026-08-03 00:08:57', transaction_type: 'Order Payment', related_id: 'PO-211-03511675479672653', order_id: 'PO-211-03511675479672653', total: '20.00', currency: 'USD' }
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].feeType, 'outbound_label_purchase');
  assert.equal(rows[0].amount, 6.22);
  assert.equal(rows[1].feeType, 'outbound_label_adjustment');
  assert.equal(rows[1].amount, -2.60);
  assert.equal(rows[2].amount, 0.55);
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 4.17);
  assert.match(rows[0].externalLineId, /^temu:[a-f0-9]{64}$/);
});

test('Temu summary DO references are not mistaken for operational order IDs', () => {
  const summary = [{ date: '2026/10/15', transaction_type: 'Shipping label purchase adjustment', order_id: 'DO00261015118020553518413000468', total: '-19.91' }];
  assert.equal(_test.isTemuDetailedReport('Temu', summary), false);
  assert.equal(_test.isTemuAdjustmentSummary('Temu', summary), true);
  assert.equal(_test.isTemuDetailedReport('Temu', [{ date_time: '2026-10-15', transaction_type: 'Shipping label purchase adjustment', related_id: 'TRACK', order_id: 'PO-211-1', total: '-19.91' }]), true);
});
