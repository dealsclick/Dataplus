const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
const ui = fs.readFileSync(path.resolve(__dirname, '..', 'web', 'src', 'components', 'warehouse-route.tsx'), 'utf8');

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

const context = { Set };
vm.createContext(context);
vm.runInContext([
  functionSource('externalOperationalPoIdentifierKey'),
  functionSource('externalOperationalPoIdentifierKeys'),
  functionSource('purchaseOrderReceivingLineMatch'),
  functionSource('findPurchaseOrderReceiptLine'),
].join('\n'), context);

const expected = { id: 'po-line-lime', lineIndex: 1, sku: 'BUS143997TRV', upc: '50197020060', expectedQty: 20 };
const scanned = {
  id: 'audit-line-lime',
  sku: 'DPS10007',
  barcode: '050197020053',
  countedQty: 20,
  receivingSubstitution: true,
  receivingPurchaseOrderLineId: 'po-line-lime',
  receivingPurchaseOrderLineIndex: 1,
};

assert.equal(context.purchaseOrderReceivingLineMatch(scanned, expected), true, 'the saved receipt-level substitution satisfies the intended PO line');
assert.equal(context.purchaseOrderReceivingLineMatch({ ...scanned, receivingPurchaseOrderLineId: '', receivingPurchaseOrderLineIndex: 0 }, expected), false, 'a different PO line is not satisfied');

const po = { items: [{ id: 'first', sku: 'BUS118387TRV' }, { id: 'po-line-lime', sku: 'BUS143997TRV' }] };
assert.equal(context.findPurchaseOrderReceiptLine(po, { purchaseOrderLineId: 'po-line-lime', lineIndex: 1, sku: 'DPS10007', substitution: true }), po.items[1], 'receipt validation accepts an audited substitution against the ordered line');
assert.equal(context.findPurchaseOrderReceiptLine(po, { purchaseOrderLineId: 'po-line-lime', lineIndex: 1, sku: 'DPS10007' }), null, 'a mismatched SKU without the substitution flag remains blocked');

assert.match(server, /parts\[5\] === "match-po-line"/, 'the API exposes an audited PO-line assignment route');
assert.match(server, /receivingSubstitutionReason/, 'the substitution reason is persisted');
assert.match(server, /const sku = String\(substitution \? line\.sku/, 'physical inventory posts to the scanned SKU');
assert.match(server, /poLine\.receivedQty = Number\(poLine\.receivedQty/, 'the ordered PO line receives credit');
assert.match(ui, /Match to PO line/, 'warehouse users can assign an extra scan to the intended PO line');
assert.match(ui, /Catalog products stay separate/, 'the UI explains that the catalog identities are not merged');

console.log('PO receiving substitutions preserve the scanned inventory SKU while satisfying the selected ordered line.');
