const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyTemuTransaction, temuRows } = require('../lib/temu-settlement-report');

function row(transactionType, total, serviceFee = '0.00', serviceFeeTax = '0.00') {
  return {
    'Date/time': '2026-10-15 12:34:56',
    'Transaction type': transactionType,
    'Related ID': 'DO00261015118020553518413000468',
    'Order ID': 'PO-211-12345678901234567',
    'Order item ID': '211-12345678901234567',
    'Service fee': serviceFee,
    'Service fee tax': serviceFeeTax,
    Total: total,
    Currency: 'USD'
  };
}

async function run() {
  const payment = classifyTemuTransaction(row('Order Payment', '33.50', '-0.69'), 1);
  assert.equal(payment.grossAmount, 34.19);
  assert.equal(payment.feeAmount, 0.69);
  assert.equal(payment.shippingCostAmount, 0);

  const refund = classifyTemuTransaction(row('Refund', '-22.98', '3.59'), 1);
  assert.equal(refund.grossAmount, -26.57);
  assert.equal(refund.refundAmount, 26.57);
  assert.equal(refund.feeAmount, -3.59);

  const label = classifyTemuTransaction(row('Shipping label purchase', '-3.77'), 1);
  const adjustment = classifyTemuTransaction(row('Shipping label purchase adjustment', '-6.13'), 1);
  const returnCredit = classifyTemuTransaction(row('Return shipping-Pickup fee credit', '1.25'), 1);
  assert.equal(label.shippingCostAmount, 3.77);
  assert.equal(adjustment.shippingCostAmount, 6.13);
  assert.equal(returnCredit.shippingCostAmount, -1.25);
  assert.equal(returnCredit.isReturnShipping, true);

  const classifications = new Map([
    ['Advertising service fee', 'advertising_fee'],
    ['Refund', 'refund'],
    ['Order Payment', 'order_payment'],
    ['Transfer', 'payout_transfer'],
    ['Shipping label purchase adjustment', 'shipping_adjustment'],
    ['Shipping label for return purchase covered by platform', 'return_shipping_platform_covered'],
    ['Shipping label for return purchase adjustment covered by platform', 'return_shipping_adjustment_platform_covered'],
    ['Shipping label purchase', 'shipping_label'],
    ['Platform reimbursement', 'platform_reimbursement'],
    ['Shipping label for return purchase', 'return_shipping'],
    ['Shipping label for return purchase adjustment', 'return_shipping_adjustment'],
    ['Chargeback processing fee', 'chargeback_fee'],
    ['Transfer of funds unsuccessful', 'payout_transfer_reversal'],
    ['Return shipping-Pickup fee credit', 'return_shipping_credit'],
    ['Fraudulent fulfillment deduction', 'fraudulent_fulfillment_deduction']
  ]);
  for (const [transactionType, category] of classifications) {
    assert.equal(classifyTemuTransaction(row(transactionType, '-1.00'), 1).category, category, transactionType);
  }

  const repeated = classifyTemuTransaction(row('Order Payment', '33.50', '-0.69'), 1);
  assert.equal(repeated.lineId, payment.lineId);
  assert.notEqual(classifyTemuTransaction(row('Order Payment', '33.50', '-0.69'), 2).lineId, payment.lineId);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dataplus-temu-report-'));
  const filePath = path.join(directory, 'report.csv');
  fs.writeFileSync(filePath, [
    '"Date/time","Transaction type","Related ID","Order ID","Total","Currency","SKU"',
    '"2026-10-15 12:34:56","Order Payment","DO-1","PO-1","10.00","USD","Title, with comma"',
    '"2026-10-15 13:00:00","Refund","DO-2","PO-2","-2.00","USD","Two-line',
    'title"'
  ].join('\n'));
  const parsed = [];
  for await (const record of temuRows(filePath)) parsed.push(record.raw);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].sku, 'Title, with comma');
  assert.equal(parsed[1].sku, 'Two-line\ntitle');
  fs.rmSync(directory, { recursive: true, force: true });

  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const database = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  const importer = fs.readFileSync(path.join(__dirname, '..', 'lib', 'temu-settlement-report.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, 'dataplus-worker.js'), 'utf8');
  const accountingUi = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'channel-fees-accounting.tsx'), 'utf8');
  const shippingUi = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'sales-shipping-report.tsx'), 'utf8');
  assert.match(server, /queueTemuSettlementReportImport/);
  assert.match(server, /shipping\/temu-settlements/);
  assert.match(worker, /temu-settlement-report-import/);
  assert.match(database, /settlement_financials\.gross_sales/);
  assert.match(database, /salesShippingReportingTemuSettlements/);
  assert.match(importer, /actual_shipping_cost=totals\.actual_cost/);
  assert.match(accountingUi, /channel-fees\/temu-report/);
  assert.match(shippingUi, /Temu settlement transaction breakdown/);
  console.log('Temu settlement report tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
