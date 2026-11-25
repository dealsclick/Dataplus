const assert = require("node:assert/strict");
const { cancelPurchaseOrderLines } = require("../server");

function purchaseOrder(overrides = {}) {
  return {
    id: "po-141088",
    poNumber: "PO#141088",
    status: "in_transit",
    submittedAt: "2026-11-24T12:00:00.000Z",
    submissionActive: true,
    supplier: "CEI",
    warehouseName: "Staten Island 2",
    items: [
      { id: "line-1", sku: "BUS-ONE", title: "First item", qty: 5, receivedQty: 0, unitCost: 10 },
      { id: "line-2", sku: "BUS-TWO", title: "Second item", qty: 3, receivedQty: 0, unitCost: 20 },
    ],
    ...overrides,
  };
}

const committed = purchaseOrder();
const result = cancelPurchaseOrderLines(committed, [], {
  lines: [{ lineIndex: 0, reasonCode: "buyer_removed", reasonNote: "Supplier removed the line" }],
  user: "Luis",
});
assert.equal(result.cancellations.length, 1);
assert.equal(result.allOpenLinesCanceled, false);
assert.equal(committed.items[0].canceledQty, 5);
assert.equal(committed.items[0].status, "canceled");
assert.equal(committed.items[1].canceledQty, undefined);
assert.equal(committed.status, "in_transit");
assert.equal(committed.totalUnits, 3);
assert.equal(committed.supplierAmendment.status, "pending_supplier_confirmation");
assert.equal(committed.supplierAmendment.before.items[0].openQty, 5);
assert.equal(committed.supplierAmendment.after.items[0].openQty, 0);
assert.equal(committed.supplierAmendment.after.items[0].canceledQty, 5);
assert.equal(committed.lineCancellations[0].reasonLabel, "Removed by buyer");
assert.match(committed.timeline.at(-1).message, /supplier amendment is pending/i);

const pendingScan = purchaseOrder({
  activeReceivingAudit: {
    auditId: "audit-230",
    lineProgress: [{ purchaseOrderLineId: "line-1", purchaseOrderLineIndex: 0, countedQty: 2 }],
  },
});
assert.throws(() => cancelPurchaseOrderLines(pendingScan, [], {
  lines: [{ lineIndex: 0, reasonCode: "buyer_removed" }],
}), /Remove that scan first/);

const received = purchaseOrder({
  items: [
    { id: "line-1", sku: "BUS-ONE", qty: 5, receivedQty: 1, unitCost: 10 },
    { id: "line-2", sku: "BUS-TWO", qty: 3, receivedQty: 0, unitCost: 20 },
  ],
});
assert.throws(() => cancelPurchaseOrderLines(received, [], {
  lines: [{ lineIndex: 0, reasonCode: "buyer_removed" }],
}), /received quantity and cannot be removed/);

assert.throws(() => cancelPurchaseOrderLines(purchaseOrder({ status: "completed" }), [], {
  lines: [{ lineIndex: 0, reasonCode: "buyer_removed" }],
}), /cannot have lines removed/);

console.log("Purchase order line removal: committed amendments, pending scans, and received quantity guards passed.");
