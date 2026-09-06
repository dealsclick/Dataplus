import test from 'node:test';
import assert from 'node:assert/strict';
import { orderFinancialGroups, returnFinancialRows, temuUsd, numeric, paymentEvents } from '../web/src/lib/order-transactions.ts';

const usd = amount => ({ amount, currency: 'USD' });
const order = parentOrderMap => ({ source: 'Temu', currency: 'USD', external: { amount: { parentOrderMap } } });
const refund = (total, item, tax, status = 5) => ({ source: 'Temu', currency: 'USD', external: { detail: { parentAfterSalesStatus: status, refundSummary: { buyerTotalRefund: usd(total), retailPriceRefundTaxExcl: usd(item), taxTotalRefund: usd(tax) } } } });
const value = (groups, label) => groups.flatMap(group => group.rows).find(row => row.label === label)?.amount;

test('verified examples keep buyer refunds separate from net seller proceeds and deductions', () => {
  for (const [total, item, tax, deduction, net] of [[1716, 1571, 145, 1466, 4337], [2238, 2077, 161, 1932, 299]]) {
    const rows = returnFinancialRows(refund(total, item, tax));
    assert.equal(rows[0].amount, total / 100);
    assert.equal(rows[0].status, 'Completed');
    const groups = orderFinancialGroups(order({ estimatedRevenue: usd(net), estimatedRevenueDeduction: usd(deduction) }), { estimatedCogs: 1, shippingLabelCost: 0.5 });
    assert.equal(value(groups, 'Estimated seller deduction'), deduction / 100);
    assert.equal(value(groups, 'Net estimated seller proceeds'), net / 100);
    assert.equal(value(groups, 'Proceeds before reported deduction'), (net + deduction) / 100);
    assert.equal(value(groups, 'Estimated contribution before other fees'), (net - 150) / 100);
    assert.equal(value(groups, 'Final settled seller deduction'), null);
    assert.ok(!rows.some(row => /deduction/i.test(row.label)));
  }
});

test('missing, invalid, and unsupported amounts are unknown, but zero is preserved', () => {
  for (const invalid of [null, undefined, '', ' ', {}, [], false, NaN, Infinity]) assert.equal(numeric(invalid), null);
  assert.equal(temuUsd(usd(0)), 0);
  assert.equal(temuUsd(usd(1.5)), null);
  assert.equal(temuUsd({ amount: 500, currency: 'JPY' }), null);
  const groups = orderFinancialGroups(order({ estimatedRevenue: usd(0), customerPaid: usd(0) }));
  assert.equal(value(groups, 'Customer-paid balance after reported refunds'), 0);
  assert.equal(value(groups, 'Net estimated seller proceeds'), 0);
  assert.equal(value(groups, 'Estimated seller deduction'), null);
  assert.equal(value(groups, 'Estimated contribution before other fees'), null);
  assert.equal(value(orderFinancialGroups({ ...order({ estimatedRevenue: usd(100) }), currency: 'EUR' }), 'Net estimated seller proceeds'), null);
});

test('processing and denied refunds are not completed', () => {
  for (const code of [1, 4, 9]) assert.equal(returnFinancialRows(refund(100, 100, 0, code))[0].status, 'Pending');
  for (const code of [6, 7]) assert.equal(returnFinancialRows(refund(100, 100, 0, code))[0].status, 'Not completed');
  assert.equal(returnFinancialRows({ source: 'temu' })[0].status, 'Pending');
});

test('payment events preserve authorization/refund kinds and channel references without netting twice', () => {
  const events = paymentEvents({ payments: [{ id: 'p', transactionId: 'channel-id', kind: 'authorization', amount: 10, createdAt: '2026-09-01' }], refunds: [{ id: 'r', amount: 5, refundedAt: '2026-09-02' }] });
  assert.equal(events[0].type, 'Refund');
  assert.equal(events[1].type, 'authorization');
  assert.equal(events[1].reference, 'channel-id');
  assert.equal(events.length, 2);
});

test('documented nested amount shape maps explicit fields, never arbitrary totals', () => {
  const groups = orderFinancialGroups({ source: 'temu', currency: 'USD', external: { amount: { salesProceeds: { estimatedSettlementTotal: usd(299), estimatedDeduction: usd(1932) }, customerPaid: { customerPaidTotal: usd(299), productRefundsTotal: usd(2077) } } } });
  assert.equal(value(groups, 'Net estimated seller proceeds'), 2.99);
  assert.equal(value(groups, 'Estimated seller deduction'), 19.32);
  assert.equal(value(groups, 'Buyer item refunds excluding tax'), 20.77);
  assert.equal(value(orderFinancialGroups(order({ arbitrary: { estimatedRevenue: usd(900) } })), 'Net estimated seller proceeds'), null);
});

test('return currency comes from the money object and aggregate deductions never repeat per case', () => {
  const record = { ...refund(2238, 2077, 161), currency: 'EUR' };
  assert.equal(returnFinancialRows(record)[0].currency, 'USD');
  for (const entry of [record, refund(1716, 1571, 145)]) assert.ok(returnFinancialRows(entry).every(row => !/seller deduction/i.test(row.label)));
  assert.equal(returnFinancialRows({ source: 'eBay', actualRefundAmount: 0 })[0].amount, 0);
  assert.equal(returnFinancialRows({ source: 'eBay', amount: 100, refundAmountUnverified: true })[0].amount, null);
});
