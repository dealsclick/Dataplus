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
}, [{ ...purchaseOrderLines[0], upc: "", catalogBarcode: "045242123456" }]);
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

const currentCatalogIdentity = reconcileWarehouseAuditPurchaseOrderCatalog({
  ...audit,
  purchaseOrderExpectedLines: [{
    ...audit.purchaseOrderExpectedLines[0],
    sku: "",
    upc: "",
    vendorItemNumber: "old-import-reference",
    manufacturerSku: "old-import-reference",
    supplierSku: "old-import-reference"
  }],
  lines: [{
    ...audit.lines[0],
    sku: "BUS-OLD-SUPPLIER",
    selectedSupplierSku: "BUS-OLD-SUPPLIER",
    selectedVendorSku: "",
    barcode: "045242123456",
    pendingCatalogResolution: true,
    reviewStatus: "needs_catalog_link"
  }]
}, [{ ...purchaseOrderLines[0], upc: "", catalogBarcode: "045242123456" }]);
assert.equal(currentCatalogIdentity.lines[0].sku, "BUS48228441CEI");
assert.equal(currentCatalogIdentity.lines[0].countedQty, 20);
assert.equal(currentCatalogIdentity.lines[0].pendingCatalogResolution, false);
assert.equal(currentCatalogIdentity.lines[0].reviewStatus, "unreviewed");

const historicalUnknown = reconcileWarehouseAuditPurchaseOrderCatalog({
  ...audit,
  purchaseOrderExpectedLines: [{
    ...audit.purchaseOrderExpectedLines[0],
    sku: "",
    upc: "",
    vendorItemNumber: "old-import-reference",
    manufacturerSku: "old-import-reference",
    supplierSku: "old-import-reference"
  }],
  lines: [],
  unknownBarcodes: [{
    barcode: "045242123456",
    count: 20,
    locationBin: "SI2-COUNT",
    scannedAt: "2026-11-23T14:00:00.000Z",
    lastScannedBy: "Warehouse user",
    receivingContributors: [{ user: "Warehouse user", quantity: 20 }]
  }]
}, [{ ...purchaseOrderLines[0], upc: "", catalogBarcode: "045242123456" }]);
assert.equal(historicalUnknown.unknownBarcodes.length, 0);
assert.equal(historicalUnknown.lines.length, 1);
assert.equal(historicalUnknown.lines[0].sku, "BUS48228441CEI");
assert.equal(historicalUnknown.lines[0].countedQty, 20);
assert.equal(historicalUnknown.lines[0].receivingPurchaseOrderLineId, "po-line-1");
assert.equal(historicalUnknown.lines[0].historicalUnknownBarcodeReconciled, true);
assert.deepEqual(historicalUnknown.lines[0].receivingContributors, [{ user: "Warehouse user", quantity: 20 }]);

const unmatchedHistoricalUnknown = reconcileWarehouseAuditPurchaseOrderCatalog({
  ...audit,
  lines: [],
  unknownBarcodes: [{ barcode: "999999999999", count: 3 }]
}, purchaseOrderLines);
assert.equal(unmatchedHistoricalUnknown.lines.length, 0);
assert.equal(unmatchedHistoricalUnknown.unknownBarcodes.length, 1);

const canceledExpectedLine = reconcileWarehouseAuditPurchaseOrderCatalog({
  ...audit,
  lines: [],
  unknownBarcodes: []
}, [{
  ...purchaseOrderLines[0],
  qty: 20,
  receivedQty: 0,
  canceledQty: 20
}]);
assert.equal(canceledExpectedLine.purchaseOrderExpectedLines.length, 0, "Canceled PO lines must disappear from an active receipt audit.");

console.log("PO audit catalog identity synchronization tests passed");
