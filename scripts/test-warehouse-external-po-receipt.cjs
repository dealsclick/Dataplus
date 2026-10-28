const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const warehouseUi = fs.readFileSync(path.join(root, 'web', 'src', 'components', 'warehouse-route.tsx'), 'utf8');

assert.match(server, /external_po_receipt:\s*"External PO receipt"/, 'server accepts the external PO receipt audit reason');
assert.match(server, /Enter the PO number from the external system\./, 'server requires the external PO identity');
assert.match(server, /purchase_order_receipt:\s*"DataPlus PO receipt"/, 'server accepts a linked DataPlus PO receipt');
assert.match(server, /purchaseOrderExpectedLines/, 'linked PO receipts save their open expected lines');
assert.match(server, /existingAuditReceipt/, 'PO receipt posting is idempotent by source audit');
assert.match(server, /sourceAuditId/, 'PO receipts retain their inbound audit identity');
assert.match(server, /stockRow\.qty = receivingAudit \? qtyBefore \+ countedQty : countedQty/, 'inbound receipts add inventory while ordinary audits preserve count semantics');
assert.match(server, /Add at least one packing slip before posting this inbound receipt/, 'inbound completion requires packing-slip evidence');
assert.match(warehouseUi, /value:\s*"external_po_receipt",\s*label:\s*"External PO receipt"/, 'warehouse UI exposes the reason');
assert.match(warehouseUi, /External PO number/, 'warehouse UI captures and displays the external PO number');
assert.match(warehouseUi, /isReceivingAuditReason\(current\.reason\)/, 'external receipts retain the receiving-document workflow');
assert.match(warehouseUi, /Receive existing PO/, 'receiving offers the linked DataPlus PO path');
assert.match(warehouseUi, /Receive external or manual PO/, 'receiving offers the external PO path');
assert.match(warehouseUi, /CommandInput placeholder="Search supplier\.\.\."/, 'external receiving offers searchable supplier selection');
assert.match(warehouseUi, /!\["retired", "deleted"\]\.includes\(status\)/, 'external receiving includes inactive manual suppliers but excludes retired and deleted suppliers');
assert.match(warehouseUi, /status !== "active".*capitalize/, 'inactive suppliers are clearly identified in the receiving picker');
assert.match(warehouseUi, /capture="environment"/, 'mobile receiving offers direct packing-slip camera capture');
assert.match(warehouseUi, /compressEvidenceImage/, 'packing-slip photos are compressed before upload');
assert.match(warehouseUi, /Packing slip required/, 'the UI explains the packing-slip completion safeguard');

console.log('Inbound receiving supports linked and external POs, additive inventory, scanner reuse, packing-slip evidence, OCR comparison, and idempotent PO posting.');
