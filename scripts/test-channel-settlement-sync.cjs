const test = require('node:test');
const assert = require('node:assert/strict');
const { isoDate, walmartReportDates, walmartReportFiles, walmartPayoutSummary, walmartFeeRows, ebayFeeRows, shopifyPaymentFeeRows } = require('../lib/channel-settlement-sync');

test('normalizes Walmart report period dates', () => {
  assert.equal(isoDate('12/19/2025'), '2025-12-19');
  assert.equal(isoDate('2026-10-15T04:00:00Z'), '2026-10-15');
  assert.equal(isoDate('""'), null);
});

test('extracts Walmart report dates from changing response envelopes', () => {
  assert.deepEqual(walmartReportDates({ availableFiles: [{ reportDate: '20261014' }, { date: '2026-10-01' }, { reportDate: '10152026' }] }), ['20261001', '20261014', '20261015']);
  assert.deepEqual(walmartReportFiles({ availableApReportDates: ['10152026'] }), [{ canonicalDate: '20261015', reportDate: '10152026', isoDate: '2026-10-15' }]);
});
test('keeps only Walmart marketplace fee amounts and signs refunds as credits', () => {
  const rows = walmartFeeRows([
    { 'Transaction Key': 'a', 'Transaction Type': 'SALE', 'Amount Type': 'Commission', Amount: '-2.50', 'Purchase Order #': '123' },
    { 'Transaction Key': 'b', 'Transaction Type': 'REFUNDED', 'Amount Type': 'Commission', Amount: '2.50', 'Purchase Order #': '123' },
    { 'Transaction Key': 'c', 'Transaction Type': 'SALE', 'Amount Type': 'Product Price', Amount: '20', 'Purchase Order #': '123' }
  ]);
  assert.deepEqual(rows.filter(row => row.feeType !== 'PAYOUT_EVIDENCE').map(row => row.feeAmount), [2.5, -2.5]);
  assert.equal(rows.find(row => row.transactionId === 'c')?.feeType, 'PAYOUT_EVIDENCE');
  assert.equal(rows[0].transactionId, 'a'); assert.equal(rows[0].transactionAmount, -2.5);
});
test('treats Walmart WFS fulfillment charges and reimbursements as reconciled fees', () => {
  const rows = walmartFeeRows([
    { 'Transaction Key': 'wfs-fee', 'Transaction Type': 'Adjustment', 'Amount Type': 'Fee/Reimbursement', 'Transaction Description': 'WFS Fulfillment fee', Amount: '-8.97', 'Purchase Order #': '123' },
    { 'Transaction Key': 'wfs-credit', 'Transaction Type': 'Adjustment', 'Amount Type': 'Fee/Reimbursement', 'Transaction Description': 'WFS Fulfillment fee reimbursement', Amount: '2.25', 'Purchase Order #': '123' },
    { 'Transaction Key': 'not-a-fee', 'Transaction Type': 'Adjustment', 'Amount Type': 'Fee/Reimbursement', 'Transaction Description': 'Inventory reimbursement', Amount: '4.00', 'Purchase Order #': '123' }
  ]);
  assert.deepEqual(rows.filter(row => row.feeType !== 'PAYOUT_EVIDENCE').map(row => row.feeAmount), [8.97, -2.25]);
  assert.equal(rows.find(row => row.transactionId === 'not-a-fee')?.feeType, 'PAYOUT_EVIDENCE');
});
test('retains Walmart order payout evidence even when a transaction has no fee row', () => {
  const rows = walmartFeeRows([{ 'Transaction Key': 'sale-1', 'Transaction Type': 'SALE', 'Amount Type': 'Product Price', Amount: '20', 'Purchase Order #': '123', 'Transaction Posted Timestamp': '10/15/2026' }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].feeType, 'PAYOUT_EVIDENCE'); assert.equal(rows[0].transactionAmount, 20);
});
test('extracts Walmart completed payout evidence from the payment summary', () => {
  const payout = walmartPayoutSummary([{ 'Transaction Type': 'PaymentSummary', 'Total Payable': '100.25', 'Transaction Description': 'Deposited in account', 'Transaction Posted Timestamp': '10/15/2026' }], { canonicalDate: '20261015' }, { payload: { accountSummary: { paymentProcessor: 'Walmart processor' } } });
  assert.equal(payout.payoutAmount, 100.25); assert.equal(payout.payoutDate, '2026-10-15T00:00:00.000Z'); assert.equal(payout.payoutStatus, 'SUCCEEDED');
  assert.deepEqual(payout.payoutInstrument, { instrumentType: 'PAYMENT_PROCESSOR', nickname: 'Walmart processor' });
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
test('normalizes Shopify Payments processing fees and order references', () => {
  const rows = shopifyPaymentFeeRows([{ id: 'gid://shopify/ShopifyPaymentsBalanceTransaction/3697060315440', type: 'CHARGE', transactionDate: '2026-05-21T17:20:28Z', amount: { amount: '66.72', currencyCode: 'USD' }, fee: { amount: '2.10', currencyCode: 'USD' }, net: { amount: '64.62', currencyCode: 'USD' }, associatedOrder: { id: 'gid://shopify/Order/18657206960432', name: '#6862' }, associatedPayout: { id: 'gid://shopify/ShopifyPaymentsPayout/141990723888', status: 'PAID' } }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].feeAmount, 2.1); assert.equal(rows[0].payoutId, '141990723888');
  assert.deepEqual(rows[0].orderReferences, ['gid://shopify/Order/18657206960432', '#6862', '6862']);
  assert.equal(rows[0].transactionAmount, 64.62); assert.equal(rows[0].feeType, 'SHOPIFY_PAYMENTS_PROCESSING_FEE');
});
test('retains zero-fee Shopify order adjustments as payout evidence', () => {
  const rows = shopifyPaymentFeeRows([{ id: 'gid://shopify/ShopifyPaymentsBalanceTransaction/2', type: 'TAX_ADJUSTMENT_DEBIT', fee: { amount: '0' }, net: { amount: '-1.45', currencyCode: 'USD' }, associatedOrder: { id: 'gid://shopify/Order/9', name: '#9' }, associatedPayout: { id: 'gid://shopify/ShopifyPaymentsPayout/3', status: 'PAID' } }]);
  assert.equal(rows[0].feeType, 'PAYOUT_EVIDENCE'); assert.equal(rows[0].feeAmount, 0); assert.equal(rows[0].bookingEntry, 'DEBIT');
});
