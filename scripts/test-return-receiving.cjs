const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findReturnReceipts } = require('../lib/return-receiving-lookup');
const { validateReturnReceipt, returnNeedsAttention } = require('../lib/return-workflow');
test('receiving lookup route is registered before the generic return detail route', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const receivingLookupRoute = serverSource.indexOf('url.pathname === "/api/returns/receiving-lookup"');
  const returnDetailRoute = serverSource.indexOf('parts[1] === "returns" && parts[2] && !parts[3]');
  assert.notEqual(receivingLookupRoute, -1);
  assert.notEqual(returnDetailRoute, -1);
  assert.ok(receivingLookupRoute < returnDetailRoute, 'the generic return detail route would swallow receiving-lookup');
  assert.match(serverSource, /receiving-lookup[\s\S]*readProductsByKeys\(skus[\s\S]*defaultImage/, 'receiving lookup must enrich returned items with compact catalog images');
  assert.match(serverSource, /receiptAttachments[\s\S]*attachmentCount: receiptAttachments\.length/, 'receiving history must retain the photo evidence count');
  const dbSource = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  assert.match(dbSource, /orderNumber: data\.orderNumber \|\| linked\?\.order_number[\s\S]*channelOrderId: data\.channelOrderId/, 'receiving lookup must fill linked DataPlus and channel order numbers');
});
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
test('carrier label scans use shared normalization across channel tracking fields', () => {
  const records = [
    { id: 'short', orderNumber: '12345' },
    { id: 'ups', returnTracking: [{ trackingNo: '1Z 999-AA1-01 2345 6784' }] },
    { id: 'usps', returnTracking: [{ mailNo: '9400111899560000000000' }] },
    { id: 'fedex', returnTracking: [{ trackingCode: '1234 5678 9012' }] },
    { id: 'label-history', returnLabelHistory: [{ waybillNumber: 'JJD000225478000123456' }] },
  ];
  assert.equal(findReturnReceipts(records, ']C11Z999AA10123456784')[0].id, 'ups');
  assert.equal(findReturnReceipts(records, '420100019400111899560000000000')[0].id, 'usps');
  assert.equal(findReturnReceipts(records, 'https://carrier.test/track?trackingNumber=123456789012')[0].id, 'fedex');
  assert.equal(findReturnReceipts(records, 'JJD000225478000123456')[0].id, 'label-history');
  assert.equal(findReturnReceipts(records, 'routing-0000012345').length, 0);
});
test('warehouse receiving searches linked customer, address and item details', () => {
  const records = [
    { id: 'older', returnNumber: 'RET-1', customerName: 'Jamie Rivera', customerPhone: '(718) 555-0123', customerEmail: 'jamie@example.com', shippingAddress: { city: 'Brooklyn', state: 'NY', postalCode: '11220' }, items: [{ sku: 'BUS-100', upc: '044476133466', sourceSkus: ['TV-900'] }] },
    { id: 'exact', returnNumber: 'JAMIE', customerName: 'Someone Else' },
  ];
  assert.deepEqual(findReturnReceipts(records, 'rivera').map(row => row.id), ['older']);
  assert.deepEqual(findReturnReceipts(records, '5550123').map(row => row.id), ['older']);
  assert.deepEqual(findReturnReceipts(records, '11220').map(row => row.id), ['older']);
  assert.deepEqual(findReturnReceipts(records, 'jamie@example.com').map(row => row.id), ['older']);
  assert.deepEqual(findReturnReceipts(records, 'BUS-100').map(row => row.id), ['older']);
  assert.deepEqual(findReturnReceipts(records, '044476133466').map(row => row.id), ['older']);
  assert.deepEqual(findReturnReceipts(records, 'TV-900').map(row => row.id), ['older']);
  assert.deepEqual(findReturnReceipts(records, 'jamie').map(row => row.id), ['exact', 'older']);
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
  assert.equal(validateReturnReceipt(record, { ...body, receiptOnly: true, warehouseId: "" }, []), "");
  assert.match(validateReturnReceipt(record, { ...body, warehouseId: "" }, []), /physical/);
  assert.equal(returnNeedsAttention({ channelLifecycleStatus: 'closed', receivingStatus: 'received' }), true);
  assert.match(validateReturnReceipt(record, { ...body, status: 'done', disposition: 'restock', inspectionStatus: 'pending' }, [warehouse]), /inspection/);
  assert.match(validateReturnReceipt({ ...record, updatedAt: 'new' }, { ...body, receiptOnly: true, expectedUpdatedAt: 'old' }, [warehouse]), /changed/);
  assert.match(validateReturnReceipt(record, { ...body, receiptOnly: true, status: 'done' }, [warehouse]), /separate/);
  assert.match(validateReturnReceipt({ ...record, restockedAt: 'today' }, { ...body, receiptOnly: true }, [warehouse]), /restocked/);
  assert.match(validateReturnReceipt(record, { ...body, receiptOnly: true, attachments: [{ dataUrl: 'data:text/html;base64,AAAA' }] }, [warehouse]), /photos/);
  assert.match(validateReturnReceipt({ items: [{ sku: 'A', qty: 2, receivedQty: 2 }, record.items[1]] }, { ...body, receiptOnly: true }, [warehouse]), /reduced/);
});
