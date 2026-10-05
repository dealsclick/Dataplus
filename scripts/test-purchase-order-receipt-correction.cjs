const assert = require("node:assert/strict");
const {
  applyPurchaseOrderReceiptHistoryCorrection,
  purchaseOrderReceiptCorrectionReasons,
  purchaseOrderStatusAfterReceiptCorrection,
} = require("../server");

assert.equal(purchaseOrderReceiptCorrectionReasons.received_by_mistake, "Received by mistake");

const line = { sku: "BUS-TEST", routeId: "route-1", qty: 10, receivedQty: 8 };
const po = {
  id: "po-1",
  status: "received",
  approval: { status: "approved" },
  items: [line],
  receipts: [
    { id: "receipt-2", items: [{ sku: "BUS-TEST", routeId: "route-1", qtyReceived: 3 }] },
    { id: "receipt-1", items: [{ sku: "BUS-TEST", routeId: "route-1", qtyReceived: 5 }] },
  ],
};

const partial = applyPurchaseOrderReceiptHistoryCorrection(po, [{ line, reduceBy: 2 }], {
  correctionId: "correction-1",
  now: "2026-10-05T12:00:00.000Z",
  user: "Test User",
  reasonLabel: "Quantity correction",
});
assert.equal(partial.reversedReceiptItems.length, 1);
assert.equal(po.receipts[0].items[0].reversedQty, 2);
assert.equal(po.receipts[0].status, "partially_reversed");

const remainder = applyPurchaseOrderReceiptHistoryCorrection(po, [{ line, reduceBy: 6 }], {
  correctionId: "correction-2",
  now: "2026-10-05T12:05:00.000Z",
  user: "Test User",
  reasonLabel: "Received by mistake",
});
assert.equal(remainder.reversedReceiptItems.length, 2);
assert.equal(po.receipts[0].items[0].reversedQty, 3);
assert.equal(po.receipts[0].status, "reversed");
assert.equal(po.receipts[1].items[0].reversedQty, 5);
assert.equal(po.receipts[1].status, "reversed");

assert.throws(
  () => applyPurchaseOrderReceiptHistoryCorrection(po, [{ line, reduceBy: 1 }], { correctionId: "correction-3" }),
  /Receipt history is missing 1 unit/,
);

assert.equal(purchaseOrderStatusAfterReceiptCorrection({ items: [{ receivedQty: 2 }] }), "partially_received");
assert.equal(purchaseOrderStatusAfterReceiptCorrection({ items: [{ receivedQty: 0 }], trackingNumber: "1ZTEST" }), "in_transit");
assert.equal(purchaseOrderStatusAfterReceiptCorrection({ items: [{ receivedQty: 0 }], submittedAt: "2026-10-05T10:00:00.000Z" }), "awaiting_tracking");
assert.equal(purchaseOrderStatusAfterReceiptCorrection({ items: [{ receivedQty: 0 }], approval: { status: "approved" } }), "ready_to_send");
assert.equal(purchaseOrderStatusAfterReceiptCorrection({ items: [{ receivedQty: 0 }] }), "draft");

console.log("Purchase-order receipt correction tests passed.");
