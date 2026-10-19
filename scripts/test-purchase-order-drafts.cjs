const assert = require("node:assert/strict");
const {
  createManualPurchaseOrder,
  manualPurchaseOrderDraftIssues
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

console.log("purchase-order draft tests passed");
