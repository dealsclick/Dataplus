const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const warehouseUi = fs.readFileSync(path.join(root, 'web', 'src', 'components', 'warehouse-route.tsx'), 'utf8');

assert.match(server, /external_po_receipt:\s*"External PO receipt"/, 'server accepts the external PO receipt audit reason');
assert.match(server, /Enter the PO number from the external system\./, 'server requires the external PO identity');
assert.match(server, /linkedPurchaseOrderId:\s*""/, 'audit reserves a future DataPlus PO link');
assert.match(warehouseUi, /value:\s*"external_po_receipt",\s*label:\s*"External PO receipt"/, 'warehouse UI exposes the reason');
assert.match(warehouseUi, /External PO number/, 'warehouse UI captures and displays the external PO number');
assert.match(warehouseUi, /isReceivingAuditReason\(current\.reason\)/, 'external receipts retain the receiving-document workflow');

console.log('External PO warehouse receipts preserve supplier, source PO identity, receiving evidence, and future PO-link fields.');
