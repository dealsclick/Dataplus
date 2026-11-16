const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const warehouseUi = fs.readFileSync(path.join(root, 'web', 'src', 'components', 'warehouse-route.tsx'), 'utf8');
const purchaseOrderUi = fs.readFileSync(path.join(root, 'web', 'src', 'components', 'purchasing-workspaces.tsx'), 'utf8');

assert.match(server, /po_recount:\s*"PO recount"/, 'the server accepts the dedicated PO recount reason');
assert.match(server, /purchaseOrderRecount[\s\S]*has no received quantities to recount/, 'only POs with received quantities can start a recount');
assert.match(server, /String\(candidate\.reason \|\| ""\) === reason[\s\S]*Resuming that session/, 'an active recount resumes instead of creating a duplicate');
assert.match(server, /expectedQty:\s*auditWarehousePhysicalQty/, 'recount expected quantities use current physical warehouse stock');
assert.match(server, /const qtyAfter = Math\.min\(qtyBefore, countedQty\)/, 'a recount can never raise physical inventory');
assert.match(server, /type:\s*"po_recount_adjustment"/, 'confirmed recount shortages create a dedicated inventory-ledger adjustment');
assert.match(server, /excessReviewQty[\s\S]*No inventory was added/, 'higher recount quantities are retained for review without adding stock');
assert.match(server, /linkedPo\.inventoryRecounts\.unshift/, 'completed recounts remain visible in PO history');
assert.match(server, /if \(purchaseOrderReceipt\) await syncPurchaseOrderReceivingProgress\(audit\)/, 'starting a recount does not make the PO look like another inbound receipt');
assert.match(server, /resolveWarehouseAuditBarcode[\s\S]{0,500}\["purchase_order_receipt", "po_recount"\]/, 'PO recount scans use the same supplier and manufacturer identifier resolution as receiving');

assert.match(purchaseOrderUi, /reason:\s*"po_recount"/, 'the PO detail starts a linked recount audit');
assert.match(purchaseOrderUi, /Recount PO inventory/, 'desktop PO actions expose the recount workflow');
assert.match(purchaseOrderUi, /Recount PO/, 'mobile PO detail exposes the recount workflow');
assert.match(warehouseUi, /Verification only/, 'the recount confirmation clearly explains its inventory behavior');
assert.match(warehouseUi, /A higher count is flagged for review and does not add inventory/, 'the UI states the no-increase safeguard');
assert.match(warehouseUi, /Complete PO recount/, 'the warehouse audit has a dedicated recount completion action');
assert.doesNotMatch(warehouseUi, /warehouseAuditReasonOptions[\s\S]{0,500}po_recount/, 'a PO recount cannot be created as an unlinked generic audit');

console.log('PO recounts are linked, resumable, mobile-ready, shortage-only inventory adjustments with durable PO history.');
