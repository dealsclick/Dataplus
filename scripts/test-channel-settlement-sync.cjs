const test = require('node:test');
const assert = require('node:assert/strict');
const { isoDate, walmartReportDates, walmartFeeRows, ebayFeeRows } = require('../lib/channel-settlement-sync');

test('normalizes Walmart report period dates', () => {
  assert.equal(isoDate('12/19/2025'), '2025-12-19');
  assert.equal(isoDate('2026-10-15T04:00:00Z'), '2026-10-15');
  assert.equal(isoDate('""'), null);
});

test('extracts Walmart report dates from changing response envelopes', () => {
  assert.deepEqual(walmartReportDates({ availableFiles: [{ reportDate: '20261014' }, { date: '2026-10-01' }] }), ['20261001', '20261014']);
});
test('keeps only Walmart marketplace fee amounts and signs refunds as credits', () => {
  const rows = walmartFeeRows([
    { 'Transaction Key': 'a', 'Transaction Type': 'SALE', 'Amount Type': 'Commission', Amount: '-2.50', 'Purchase Order #': '123' },
    { 'Transaction Key': 'b', 'Transaction Type': 'REFUNDED', 'Amount Type': 'Commission', Amount: '2.50', 'Purchase Order #': '123' },
    { 'Transaction Key': 'c', 'Transaction Type': 'SALE', 'Amount Type': 'Product Price', Amount: '20', 'Purchase Order #': '123' }
  ]);
  assert.deepEqual(rows.map(row => row.feeAmount), [2.5, -2.5]);
});
test('normalizes eBay line-item fees without treating payout net as a fee', () => {
  const rows = ebayFeeRows([{ transactionId: 't1', payoutId: 'p1', orderId: 'o1', transactionType: 'SALE', transactionStatus: 'PAYOUT', bookingEntry: 'CREDIT', amount: { value: '90', currency: 'USD' }, orderLineItems: [{ orderLineItemId: 'l1', feeBasisAmount: { value: '100', currency: 'USD' }, marketplaceFees: [{ feeType: 'FINAL_VALUE_FEE', amount: { value: '10', currency: 'USD' } }] }] }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].feeAmount, 10); assert.equal(rows[0].orderReference, 'o1');
  assert.equal(rows[0].payoutId, 'p1'); assert.equal(rows[0].transactionStatus, 'PAYOUT'); assert.equal(rows[0].bookingEntry, 'CREDIT');
});
test('signs an eBay refunded marketplace fee as a credit', () => {
  const rows = ebayFeeRows([{ transactionId: 't2', orderId: 'o1', transactionType: 'REFUND', orderLineItems: [{ orderLineItemId: 'l1', marketplaceFees: [{ feeType: 'FINAL_VALUE_FEE', amount: { value: '2', currency: 'USD' } }] }] }]);
  assert.equal(rows[0].feeAmount, -2);
});
test('retains payout evidence when an eBay order transaction has no marketplace fee lines', () => {
  const rows = ebayFeeRows([{ transactionId: 't3', payoutId: 'p2', orderId: 'o2', transactionType: 'SALE', transactionStatus: 'PAYOUT', bookingEntry: 'CREDIT', amount: { value: '25.50', currency: 'USD' } }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].feeAmount, 0); assert.equal(rows[0].feeType, 'PAYOUT_EVIDENCE');
  assert.equal(rows[0].transactionAmount, 25.5); assert.equal(rows[0].orderReference, 'o2');
});
