const assert = require("node:assert/strict");
const { reconcileWarehouseAuditPurchaseOrderCatalog } = require("../db");

const audit = {
  id: "audit-141088",
  reason: "purchase_order_receipt",
  supplierName: "CEI",
  linkedPurchaseOrderId: "po-141088",
  purchaseOrderExpectedLines: [
    {
      id: "po-line-1",
      lineIndex: 0,
      sku: "",
      title: "Imported unresolved item",
      vendorItemNumber: "48-22-8441",
      manufacturerSku: "48-22-8441",
      upc: "045242123456",
      supplierSku: "48-22-8441",
      supplierName: "CEI",
      expectedQty: 20,
      orderedQty: 20,
      receivedQty: 0
    }
  ],
  lines: [
    {
      id: "audit-line-1",
      productId: "DPS-OLD",
      sku: "DPS-OLD",
      title: "Imported unresolved item",
      barcode: "045242123456",
      selectedSupplierSku: "48-22-8441",
      selectedVendorSku: "48-22-8441",
      countedQty: 20,
      receivingContributors: [{ user: "Luis", quantity: 20 }]
    }
  ]
};

const purchaseOrderLines = [
  {
    id: "po-line-1",
    sku: "BUS48228441CEI",
    title: "PACKOUT Single Drawer Tool Box",
    sourceItemNumber: "48-22-8441",
    vendorSku: "48-22-8441",
    mfrPartNumber: "48-22-8441",
    upc: "045242123456",
    estimatedUnitCost: 127.92,
    resolutionStatus: "resolved"
  }
];

const reconciled = reconcileWarehouseAuditPurchaseOrderCatalog(audit, purchaseOrderLines);
assert.equal(reconciled.purchaseOrderExpectedLines[0].sku, "BUS48228441CEI");
assert.equal(reconciled.purchaseOrderExpectedLines[0].supplierSku, "48-22-8441");
assert.equal(reconciled.lines[0].sku, "BUS48228441CEI");
assert.equal(reconciled.lines[0].productId, "BUS48228441CEI");
assert.equal(reconciled.lines[0].receivingOriginalSku, "DPS-OLD");
assert.equal(reconciled.lines[0].receivingPurchaseOrderLineId, "po-line-1");
assert.equal(reconciled.lines[0].receivingPurchaseOrderLineIndex, 0);
assert.equal(reconciled.lines[0].selectedSupplierSku, "48-22-8441");
assert.equal(reconciled.lines[0].countedQty, 20);
assert.equal(reconciled.lines[0].barcode, "045242123456");
assert.deepEqual(reconciled.lines[0].receivingContributors, [{ user: "Luis", quantity: 20 }]);

const substitution = reconcileWarehouseAuditPurchaseOrderCatalog({
  ...audit,
  lines: [{
    ...audit.lines[0],
    sku: "BUS-ACTUAL-SUBSTITUTE",
    receivingSubstitution: true,
    receivingPurchaseOrderLineId: "po-line-1"
  }]
}, purchaseOrderLines);
assert.equal(substitution.lines[0].sku, "BUS-ACTUAL-SUBSTITUTE");
assert.equal(substitution.lines[0].receivingCatalogSku, "BUS48228441CEI");

const ambiguous = reconcileWarehouseAuditPurchaseOrderCatalog({
  ...audit,
  purchaseOrderExpectedLines: [
    audit.purchaseOrderExpectedLines[0],
    { ...audit.purchaseOrderExpectedLines[0], id: "po-line-2", lineIndex: 1 }
  ]
}, [purchaseOrderLines[0], { ...purchaseOrderLines[0], id: "po-line-2", sku: "BUS-SECOND" }]);
assert.equal(ambiguous.lines[0].sku, "DPS-OLD");

console.log("PO audit catalog identity synchronization tests passed");
