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
  ['BUS142523TRV', { id: 'trv-142523', sku: 'BUS142523TRV', title: 'Expected True Value product', supplier: 'True Value', supplierCode: 'TRV', vendorSku: '142523', sourceSku: 'BUS142523TRV', cost: 19.25 }],
  ['BUS210787TRV', { id: 'trv-210787', sku: 'BUS210787TRV', title: 'Expected True Value product', supplier: 'True Value', supplierCode: 'TRV', vendorSku: '210787', sourceSku: 'BUS210787TRV', cost: 12.5 }],
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
  functionSource('warehouseAuditSupplierIdentity'),
  functionSource('purchaseOrderAuditExpectedLine'),
  functionSource('purchaseOrderAuditSupplierSelection'),
  functionSource('resolveWarehouseAuditBarcode'),
].join('\n'), context);

const audit = {
  id: 'audit-221',
  reason: 'purchase_order_receipt',
  supplierId: 'true-value-id',
  supplierName: 'True Value',
  linkedPurchaseOrderId: 'po-136766-id',
  linkedPurchaseOrderNumber: 'PO#136766',
  purchaseOrderExpectedLines: [
    { sku: 'BUS142523TRV', upc: '45242749416', vendorItemNumber: '142523', manufacturerSku: '48-89-4670', unitCost: 17.75, supplierId: 'true-value-id', supplierName: 'True Value' },
    { sku: 'BUS210787TRV', upc: '45242167234', vendorItemNumber: '210787', manufacturerSku: '48-89-2801', unitCost: 11.25, supplierId: 'true-value-id', supplierName: 'True Value' },
  ],
};

(async () => {
  const first = await context.resolveWarehouseAuditBarcode(audit, '045242749416');
  assert.equal(first.product.sku, 'BUS142523TRV');
  assert.equal(first.purchaseOrderExpectedLine.sku, 'BUS142523TRV');

  const second = await context.resolveWarehouseAuditBarcode(audit, '045242167234');
  assert.equal(second.product.sku, 'BUS210787TRV');
  assert.equal(second.purchaseOrderExpectedLine.sku, 'BUS210787TRV');

  const alreadyCorrect = await context.resolveWarehouseAuditBarcode(audit, 'BUS142523TRV');
  assert.equal(alreadyCorrect.product.sku, 'BUS142523TRV');
  assert.equal(alreadyCorrect.purchaseOrderExpectedLine.sku, 'BUS142523TRV', 'the expected PO line is retained when catalog resolution already chose the correct product');

  const inherited = context.purchaseOrderAuditSupplierSelection(audit, audit.purchaseOrderExpectedLines[0], products.get('BUS142523TRV'), {}, {}, { now: '2026-11-16T12:00:00.000Z', actor: 'Luis' });
  assert.equal(inherited.selectedSupplierName, 'True Value');
  assert.equal(inherited.selectedSupplierId, 'true-value-id');
  assert.equal(inherited.selectedSupplierCost, 17.75, 'the purchase-order unit cost wins over the catalog cost');
  assert.equal(inherited.selectedVendorSku, '142523');
  assert.equal(inherited.selectedManufacturerSku, '48-89-4670');
  assert.equal(inherited.supplierInheritedFromPurchaseOrder, true);

  const extraItem = context.purchaseOrderAuditSupplierSelection(audit, null, { sku: 'BUS-OTHER', supplier: 'Different supplier', vendorSku: 'WRONG-VENDOR-SKU' }, {}, {}, { now: '2026-11-16T12:00:00.000Z', actor: 'Luis' });
  assert.equal(extraItem.selectedSupplierName, 'True Value', 'extra items still retain the shipment supplier');
  assert.equal(extraItem.selectedVendorSku, '', 'another supplier vendor SKU is not attributed to the PO supplier');

  const unrelated = await context.resolveWarehouseAuditBarcode({ reason: 'cycle_count', purchaseOrderExpectedLines: audit.purchaseOrderExpectedLines }, '045242749416');
  assert.equal(unrelated.product.sku, 'BUS495-48-89-4670ESB', 'ordinary audits keep the general catalog result');

  console.log('PO receiving resolves zero-padded UPCs to the SKU expected by the linked purchase order.');
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
