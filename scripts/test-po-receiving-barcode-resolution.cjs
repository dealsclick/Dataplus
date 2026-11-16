const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');

function functionSource(name) {
  const functionStart = server.indexOf(`function ${name}(`);
  const asyncStart = server.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 && asyncStart <= functionStart ? asyncStart : functionStart;
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

const products = new Map([
  ['BUS142523TRV', { id: 'trv-142523', sku: 'BUS142523TRV', title: 'Expected True Value product' }],
  ['BUS210787TRV', { id: 'trv-210787', sku: 'BUS210787TRV', title: 'Expected True Value product' }],
]);
const context = {
  Set,
  resolveScannedCatalogBarcode: async (barcode) => ({
    product: { id: `wrong-${barcode}`, sku: barcode === '045242749416' ? 'BUS495-48-89-4670ESB' : 'BUS495-48-89-2801ESB' },
  }),
  postgres: {
    readProductByKey: async (sku) => products.get(sku) || null,
  },
};
vm.createContext(context);
vm.runInContext([
  functionSource('externalOperationalPoIdentifierKey'),
  functionSource('externalOperationalPoIdentifierKeys'),
  functionSource('resolveWarehouseAuditBarcode'),
].join('\n'), context);

const audit = {
  reason: 'purchase_order_receipt',
  purchaseOrderExpectedLines: [
    { sku: 'BUS142523TRV', upc: '45242749416' },
    { sku: 'BUS210787TRV', upc: '45242167234' },
  ],
};

(async () => {
  const first = await context.resolveWarehouseAuditBarcode(audit, '045242749416');
  assert.equal(first.product.sku, 'BUS142523TRV');
  assert.equal(first.purchaseOrderExpectedLine.sku, 'BUS142523TRV');

  const second = await context.resolveWarehouseAuditBarcode(audit, '045242167234');
  assert.equal(second.product.sku, 'BUS210787TRV');
  assert.equal(second.purchaseOrderExpectedLine.sku, 'BUS210787TRV');

  const unrelated = await context.resolveWarehouseAuditBarcode({ reason: 'cycle_count', purchaseOrderExpectedLines: audit.purchaseOrderExpectedLines }, '045242749416');
  assert.equal(unrelated.product.sku, 'BUS495-48-89-4670ESB', 'ordinary audits keep the general catalog result');

  console.log('PO receiving resolves zero-padded UPCs to the SKU expected by the linked purchase order.');
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
