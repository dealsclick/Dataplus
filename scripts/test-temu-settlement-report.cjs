const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyTemuTransaction, temuRows, _test } = require('../lib/temu-settlement-report');

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

  const auditedOrder = classifyTemuTransaction({
    ...row('Order Payment', '33.50', '-0.69'),
    'Related ID': 'PO-211-17286699405434066',
    'Order ID': 'PO-211-17286699405434066',
    'Retail price': '35.98',
    'Platform discount': '-1.79',
    'Seller discount': '0.00',
    Subtotal: '33.50',
    'Product Tax': '2.99',
    'Marketplace Withheld Tax': '-2.99'
  }, 1);
  assert.equal(auditedOrder.grossAmount, 34.19);
  assert.equal(auditedOrder.feeAmount, 0.69);
  assert.equal(auditedOrder.netAmount, 33.50);
  assert.equal(Number((auditedOrder.grossAmount - auditedOrder.feeAmount).toFixed(2)), auditedOrder.netAmount);

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

  const importedShipment = _test.temuShipmentCandidate({ shipmentId: 'imported', trackingNumber: '384084195029', raw: { id: 'imported', trackingNumber: '384084195029', source: 'Temu' } });
  const purchasedShipment = _test.temuShipmentCandidate({ shipmentId: 'purchased', trackingNumber: '384084195029', raw: { id: 'purchased', trackingNumber: '384084195029', purchaseOrigin: 'dataplus', fulfillmentBatchId: 'batch-1017', documents: [{ documentType: 'shipping_label' }] } });
  assert.equal(_test.selectTemuShipmentCandidate([importedShipment, purchasedShipment], '384084195029')?.shipmentId, 'purchased');
  assert.equal(_test.selectTemuShipmentCandidate([importedShipment, purchasedShipment], '3.84084E+11')?.shipmentId, 'purchased');
  assert.equal(_test.selectTemuShipmentCandidate([
    importedShipment,
    _test.temuShipmentCandidate({ shipmentId: 'other', trackingNumber: '999999999999', raw: { id: 'other', trackingNumber: '999999999999' } })
  ], '3.84084E+11'), null);

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
  assert.match(database, /'platformDiscount', l\.raw->>'platform_discount'/);
  assert.match(database, /grossAmount: transaction\?\.grossAmount/);
  assert.match(importer, /actual_shipping_cost=totals\.actual_cost/);
  assert.match(accountingUi, /channel-fees\/temu-report/);
  assert.match(shippingUi, /Temu settlement transaction breakdown/);
  console.log('Temu settlement report tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
