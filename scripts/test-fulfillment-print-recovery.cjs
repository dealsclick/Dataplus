const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { restorePurchasedLabelReferences } = require("../lib/fulfillment-print");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dataplus-label-recovery-"));
try {
  const documentId = "11111111-2222-4333-8444-555555555555";
  fs.writeFileSync(path.join(root, `${documentId}.pdf`), Buffer.from("purchased-label"));
  const order = { id: "order-1", orderNumber: "54980", currency: "USD", documents: [], shipments: [] };
  const row = {
    orderId: order.id,
    shipmentId: "shipment-1",
    documentId,
    routeIds: ["route-1"],
    status: "purchased",
    shippingCost: 5.25,
    trackingNumber: "TRACK-1",
    selectedRate: { provider: "temu", carrier: "USPS", service: "Ground Advantage", currency: "USD" },
    completedAt: "2026-10-15T14:00:00.000Z"
  };
  const batch = { id: "batch-1", batchNumber: "BATCH-1097" };

  const restored = restorePurchasedLabelReferences(order, row, batch, { attachmentRoot: root });
  assert.equal(restored.changed, true);
  assert.equal(order.documents.length, 1);
  assert.equal(order.documents[0].storageKey, `${documentId}.pdf`);
  assert.equal(order.shipments.length, 1);
  assert.equal(order.shipments[0].documents[0].documentId, documentId);
  assert.equal(order.shipments[0].fulfillmentBatchId, batch.id);

  const repeated = restorePurchasedLabelReferences(order, row, batch, { attachmentRoot: root });
  assert.equal(repeated.changed, false, "recovery must be idempotent");
  assert.equal(order.documents.length, 1);
  assert.equal(order.shipments.length, 1);

  const missing = restorePurchasedLabelReferences({ id: "order-2", documents: [], shipments: [] }, { documentId: "missing" }, batch, { attachmentRoot: root });
  assert.equal(missing.changed, false);
  assert.equal(missing.document, null);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("Fulfillment print recovery tests passed.");
