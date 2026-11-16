const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');

function functionSource(name) {
  const start = server.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const bodyStart = server.indexOf(') {', start) + 2;
  let depth = 0;
  for (let index = bodyStart; index < server.length; index += 1) {
    if (server[index] === '{') depth += 1;
    if (server[index] === '}') depth -= 1;
    if (depth === 0) return server.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

const context = {
  ACTIVE_PURCHASE_ORDER_RECEIVING_STATUSES: new Set(['in_progress', 'pending_review']),
  purchaseOrderOpenQuantity: (line = {}) => Math.max(0, Number(line.qty || 0) - Number(line.receivedQty || 0) - Number(line.canceledQty || 0)),
  purchaseOrderHasSubmissionRecord: (po = {}) => Boolean(po.submittedAt || po.placedAt),
  purchaseOrderHasSupplierCommitment: (po = {}) => Boolean(po.supplierOrderNumber),
};
vm.createContext(context);
vm.runInContext([
  functionSource('activePurchaseOrderReceivingAudit'),
  functionSource('closePurchaseOrderRecord'),
  functionSource('reopenPurchaseOrderRecord'),
].join('\n'), context);

const activeAudit = { auditId: 'audit-221', auditNumber: 'AUDIT-221', status: 'in_progress', scannedUnits: 379 };
const receivingPo = { status: 'in_transit', workflowStage: 'incoming', activeReceivingAudit: activeAudit, items: [{ sku: 'A', qty: 10, receivedQty: 0 }] };
assert.throws(
  () => context.closePurchaseOrderRecord(receivingPo, { user: 'Buyer' }),
  (error) => error.statusCode === 409 && /379 scanned unit/.test(error.message),
  'an active receiving audit blocks close',
);
assert.equal(receivingPo.status, 'in_transit', 'a blocked close does not mutate the PO');

const closeablePo = { status: 'in_transit', workflowStage: 'incoming', items: [{ sku: 'A', qty: 10, receivedQty: 0 }] };
context.closePurchaseOrderRecord(closeablePo, { user: 'Buyer', note: 'Supplier shipment ended' });
assert.equal(closeablePo.status, 'closed');
assert.equal(closeablePo.closedFromStatus, 'in_transit');
assert.equal(closeablePo.workflowStage, 'history');

const closedReceivingPo = { status: 'closed', workflowStage: 'history', activeReceivingAudit: activeAudit, closedAt: '2026-11-16T19:09:53.502Z', items: [{ sku: 'A', qty: 10, receivedQty: 0 }] };
assert.throws(
  () => context.reopenPurchaseOrderRecord({ ...closedReceivingPo }, { user: 'Buyer' }),
  (error) => error.statusCode === 400 && /reason/.test(error.message),
  'terminal reopen requires a reason',
);
context.reopenPurchaseOrderRecord(closedReceivingPo, { user: 'Buyer', note: 'Finish AUDIT-221' });
assert.equal(closedReceivingPo.status, 'receiving');
assert.equal(closedReceivingPo.workflowStage, 'receiving');
assert.equal(closedReceivingPo.items[0].receivedQty, 0, 'reopen does not post inventory');
assert.equal(closedReceivingPo.closureHistory.length, 1, 'close and reopen evidence is retained');

const heldDraft = { status: 'hold', workflowStage: 'waiting_for_po', approval: { required: true, status: 'approved' }, items: [] };
context.reopenPurchaseOrderRecord(heldDraft, { user: 'Buyer' });
assert.equal(heldDraft.status, 'draft', 'existing return-to-draft behavior remains available');
assert.equal(heldDraft.approval.status, 'pending');

console.log('PO close and reopen preserve active receiving scans and operational lifecycle evidence.');
