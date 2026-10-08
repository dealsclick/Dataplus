const assert = require("node:assert/strict");
const {
  createManualPurchaseOrder,
  validatePurchaseOrderReceiptLines,
  applyUnresolvedPurchaseOrderReceipt
} = require("../server");

const db = {
  vendors: [{ id: "vendor-1", name: "Example Supplier", status: "active" }],
  warehouses: [{ id: "warehouse-1", name: "Warehouse 2", isPhysical: true, allowReceiving: true }],
  purchaseOrders: [],
  sequence: {}
};

const po = createManualPurchaseOrder(db, {
  vendorId: "vendor-1",
  warehouseId: "warehouse-1",
  externalPoNumber: "EXT-100",
  items: [
    {
      source: "external_po_pdf",
      catalogProduct: false,
      matchStatus: "unmatched",
      manufacturerPartNumber: "ABC-100",
      description: "Supplier-only product",
      qty: 4,
      unitCost: 2.5,
      generatedSku: "BUSABC100SUP"
    },
    {
      source: "external_po_pdf",
      catalogProduct: true,
      matchStatus: "matched",
      sku: "BUSKNOWN",
      title: "Known product",
      qty: 2,
      unitCost: 3
    }
  ],
  user: "Test Buyer"
});

assert.equal(po.items.length, 2);
assert.equal(po.unresolvedLineCount, 1);
assert.equal(po.items[0].sku, "");
assert.equal(po.items[0].resolutionStatus, "unresolved");
assert.equal(po.items[0].sourceItemNumber, "ABC-100");
assert.equal(po.items[0].suggestedSku, "BUSABC100SUP");
assert.equal(po.items[1].resolutionStatus, "resolved");
assert.match(po.timeline[0].message, /1 needs catalog SKU resolution/);

assert.equal(
  validatePurchaseOrderReceiptLines(po, [{ lineIndex: 0, qtyReceived: 1 }]),
  ""
);
assert.equal(
  validatePurchaseOrderReceiptLines(po, [{ lineIndex: 1, sku: "BUSKNOWN", qtyReceived: 1 }]),
  ""
);

assert.equal(applyUnresolvedPurchaseOrderReceipt(po.items[0], {
  qtyReceived: 3,
  receivedAt: "2026-10-08",
  locationBin: "UNRESOLVED-A",
  varianceStatus: "none"
}), 3);
assert.equal(po.items[0].receivedQty, 3);
assert.equal(po.items[0].unresolvedReceivedQty, 3);
assert.equal(po.items[0].remainingQty, 1);
assert.equal(po.items[0].lastLocationBin, "UNRESOLVED-A");
assert.match(
  validatePurchaseOrderReceiptLines(po, [{ lineIndex: 0, qtyReceived: 2 }]),
  /only 1 remain open/
);

assert.throws(() => createManualPurchaseOrder({ ...db, purchaseOrders: [] }, {
  vendorId: "vendor-1",
  warehouseId: "warehouse-1",
  items: [{ qty: 1, unitCost: 1 }]
}), /Enter a SKU/);

console.log("external PO unresolved-line tests passed");
