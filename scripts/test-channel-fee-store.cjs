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
