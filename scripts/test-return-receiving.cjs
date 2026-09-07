const test = require('node:test');
const assert = require('node:assert/strict');
const { findReturnReceipts } = require('../lib/return-receiving-lookup');
const { validateReturnReceipt, returnNeedsAttention } = require('../lib/return-workflow');
test('exact scans match closed returns, order references and tracking without merging cases', () => {
  const records = [
    { id: 'r1', orderNumber: 2156, channelOrderId: 'PO-1', channelLifecycleStatus: 'closed', returnNumber: 'RET1001', returnTracking: [{ trackingNumber: 'ABC123' }] },
    { id: 'r2', orderNumber: 2156, channelOrderId: 'PO-1' },
  ];
  assert.equal(findReturnReceipts(records, ' abc123 ')[0].id, 'r1');
  assert.equal(findReturnReceipts(records, '2156').length, 2);
  assert.equal(findReturnReceipts(records, 'PO-1').length, 2);
  assert.equal(findReturnReceipts(records, 'RET1001').length, 1);
  assert.equal(findReturnReceipts(records, 'ABC').length, 0);
  assert.equal(findReturnReceipts(records, '').length, 0);
});
test('receiving requires every expected line, bounded quantities and physical locations', () => {
  const record = { items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }] };
  const warehouse = { id: 'w', isPhysical: true, warehouseType: 'Returns Center', active: true };
  const body = { status: 'received', warehouseId: 'w', items: [{ sku: 'A', qty: 2, receivedQty: 1 }, { sku: 'B', qty: 1, receivedQty: 0 }] };
  assert.equal(validateReturnReceipt(record, body, [warehouse]), '');
  assert.match(validateReturnReceipt(record, { ...body, items: body.items.slice(0, 1) }, [warehouse]), /all expected/);
  assert.match(validateReturnReceipt(record, { ...body, items: [{ sku: 'A', qty: 2, receivedQty: 3 }, body.items[1]] }, [warehouse]), /whole numbers/);
  assert.match(validateReturnReceipt(record, body, [{ ...warehouse, isPhysical: false }]), /physical/);
  assert.match(validateReturnReceipt(record, body, [{ ...warehouse, allowReceiving: false }]), /physical/);
  assert.equal(returnNeedsAttention({ channelLifecycleStatus: 'closed', receivingStatus: 'received' }), true);
  assert.match(validateReturnReceipt(record, { ...body, status: 'done', disposition: 'restock', inspectionStatus: 'pending' }, [warehouse]), /inspection/);
  assert.match(validateReturnReceipt({ ...record, updatedAt: 'new' }, { ...body, receiptOnly: true, expectedUpdatedAt: 'old' }, [warehouse]), /changed/);
  assert.match(validateReturnReceipt(record, { ...body, receiptOnly: true, status: 'done' }, [warehouse]), /separate/);
  assert.match(validateReturnReceipt({ ...record, restockedAt: 'today' }, { ...body, receiptOnly: true }, [warehouse]), /restocked/);
  assert.match(validateReturnReceipt(record, { ...body, receiptOnly: true, attachments: [{ dataUrl: 'data:text/html;base64,AAAA' }] }, [warehouse]), /photos/);
  assert.match(validateReturnReceipt({ items: [{ sku: 'A', qty: 2, receivedQty: 2 }, record.items[1]] }, { ...body, receiptOnly: true }, [warehouse]), /reduced/);
});
