const assert = require("node:assert/strict");
const {
  createManualPurchaseOrder,
  manualPurchaseOrderDraftIssues,
  purchaseOrderCatalogAddition,
  applyProductPurchasingUomOverride
} = require("../server");

const db = {
  vendors: [{ id: "vendor-1", name: "Example Supplier", status: "active" }],
  warehouses: [{ id: "warehouse-1", name: "Main Warehouse", isPhysical: true, allowReceiving: true }],
  purchaseOrders: [],
  sequence: {}
};

const emptyDraft = createManualPurchaseOrder(db, {
  allowIncompleteDraft: true,
  notes: "Started while reviewing supplier pricing.",
  items: [],
  user: "Test Buyer"
});

assert.equal(emptyDraft.status, "draft");
assert.equal(emptyDraft.vendorId, "");
assert.equal(emptyDraft.warehouseId, "");
assert.deepEqual(emptyDraft.items, []);
assert.equal(emptyDraft.draftIncomplete, true);
assert.deepEqual(emptyDraft.draftMissingFields, [
  "Choose a supplier.",
  "Choose a receiving warehouse.",
  "Add at least one item."
]);

const partialDraft = createManualPurchaseOrder({ ...db, purchaseOrders: [] }, {
  allowIncompleteDraft: true,
  vendorId: "vendor-1",
  warehouseId: "warehouse-1",
  items: [{ sku: "", title: "Supplier item", qty: 1, unitCost: 4.25 }]
});

assert.equal(partialDraft.items.length, 1);
assert.equal(partialDraft.items[0].title, "Supplier item");
assert.deepEqual(partialDraft.draftMissingFields, ["Enter a SKU for line 1."]);

partialDraft.items[0].sku = "SKU-100";
assert.deepEqual(manualPurchaseOrderDraftIssues(partialDraft, db), []);

assert.throws(() => createManualPurchaseOrder({ ...db, purchaseOrders: [] }, {
  vendorId: "vendor-1",
  warehouseId: "warehouse-1",
  items: []
}), /Add at least one item/);

const catalogAddition = purchaseOrderCatalogAddition({
  vendorId: "true-value",
  supplier: "True Value"
}, {
  sku: "BUS265368TRV",
  title: "Milwaukee item",
  supplier: "Other primary supplier",
  cost: 99,
  sourceCatalogMatches: [{
    vendorId: "true-value",
    supplier: "True Value",
    vendorSku: "265368",
    cost: 5.96,
    uom: "EA",
    uomQty: 6
  }]
}, { qty: 1 });

assert.equal(catalogAddition.qty, 1, "one supplier pack should be orderable when the feed does not define a minimum or increment");
assert.equal(catalogAddition.purchaseMultiple, 1);
assert.equal(catalogAddition.uomQty, 6, "the UOM contents must remain separate from the PO quantity increment");
assert.equal(catalogAddition.purchaseUomLabel, "Pack of 6");
assert.equal(catalogAddition.estimatedUnitCost, 5.96, "the PO should use the matching supplier cost");
assert.equal(catalogAddition.vendorSku, "265368");
assert.equal(catalogAddition.source, "manual_po_addition");
assert.equal(catalogAddition.purchaseSurplusQty, 1);

const minimumAddition = purchaseOrderCatalogAddition({
  vendorId: "true-value",
  supplier: "True Value"
}, {
  sku: "BUS-MINIMUM",
  title: "Supplier minimum item",
  supplier: "True Value",
  uom: "EA",
  uomQty: 1,
  minQuantity: 6,
  cost: 2
}, { qty: 1 });

assert.equal(minimumAddition.qty, 6, "an explicit supplier minimum should still round the PO quantity");
assert.equal(minimumAddition.purchaseMultiple, 6);

const sourceDefaultAddition = purchaseOrderCatalogAddition({
  vendorId: "true-value",
  supplier: "True Value"
}, {
  sku: "BUS202637TRV",
  title: "LG Mens Blizzard Glove",
  supplier: "True Value",
  sourceCatalogMatches: [{
    vendorId: "true-value",
    supplier: "True Value",
    cost: 34.86,
    uom: "EA",
    uomQty: 3,
    raw: { minQuantity: 3, quantityIncrements: 3 }
  }]
}, { qty: 1 });

assert.equal(sourceDefaultAddition.qty, 3, "the supplier default should retain the explicit source increment");
assert.equal(sourceDefaultAddition.purchaseMultiple, 3);
assert.equal(sourceDefaultAddition.uomQty, 3);

const manualCostAddition = purchaseOrderCatalogAddition({
  vendorId: "true-value",
  supplier: "True Value"
}, {
  sku: "BUS-MANUAL-COST",
  title: "Manual cost item",
  supplier: "True Value",
  cost: 34.86
}, { qty: 1, estimatedUnitCost: 11.62 });

assert.equal(manualCostAddition.estimatedUnitCost, 11.62, "a buyer-entered PO cost should override the catalog cost for the new line");

assert.throws(() => purchaseOrderCatalogAddition({
  vendorId: "true-value",
  supplier: "True Value"
}, {
  sku: "BUS-INVALID-COST",
  title: "Invalid manual cost item",
  supplier: "True Value",
  cost: 34.86
}, { qty: 1, estimatedUnitCost: -1 }), /valid unit cost/);

const eachOverrideAddition = purchaseOrderCatalogAddition({
  vendorId: "true-value",
  supplier: "True Value"
}, {
  sku: "BUS202637TRV",
  title: "LG Mens Blizzard Glove",
  supplier: "True Value",
  sourceCatalogMatches: [{
    vendorId: "true-value",
    supplier: "True Value",
    cost: 34.86,
    uom: "EA",
    uomQty: 3,
    raw: { minQuantity: 3, quantityIncrements: 3 }
  }]
}, { qty: 1, purchaseUomMode: "each" });

assert.equal(eachOverrideAddition.qty, 1, "an explicit Each override should permit ordering one supplier unit");
assert.equal(eachOverrideAddition.purchaseMultiple, 1);
assert.equal(eachOverrideAddition.supplierPurchaseMultiple, 3);
assert.equal(eachOverrideAddition.uomQty, 1);

const packProduct = { sku: "BUS202637TRV", uom: "PK", uomQty: 3 };
applyProductPurchasingUomOverride(packProduct, "lock_each", "Test Buyer");
assert.equal(packProduct.uom, "EA");
assert.equal(packProduct.uomQty, 1);
assert.equal(packProduct.purchasingUomOverride.locked, true);
assert.equal(packProduct.purchasingUomOverride.sourceUom, "PK");
assert.equal(packProduct.purchasingUomOverride.sourceUomQty, 3);
applyProductPurchasingUomOverride(packProduct, "restore_supplier", "Test Buyer");
assert.equal(packProduct.uom, "PK");
assert.equal(packProduct.uomQty, 3);
assert.equal(packProduct.purchasingUomOverride.locked, false);

assert.throws(() => purchaseOrderCatalogAddition({
  vendorId: "true-value",
  supplier: "True Value"
}, {
  sku: "WRONG-SUPPLIER",
  supplier: "Another Supplier",
  sourceCatalogMatches: [{ vendorId: "other", supplier: "Another Supplier", cost: 1 }]
}, { qty: 1 }), /not available from True Value/);

console.log("purchase-order draft tests passed");
