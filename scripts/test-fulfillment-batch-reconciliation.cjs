const assert = require("node:assert/strict");
const { reconcileFulfillmentBatchPurchaseEvidence } = require("../server");

async function run() {
  const batch = {
    id: "batch-1066",
    batchNumber: "BATCH-1066",
    phase: "purchase",
    status: "queued",
    rows: [{
      orderId: "order-53916",
      orderNumber: "53916",
      routeIds: ["route-1"],
      status: "rated",
      selectedRate: { amount: 6.98 }
    }]
  };
  const state = {
    batches: [batch],
    printQueue: [{ id: "print-1066", batchId: batch.id, status: "ready", orderCount: 0, documentCount: 0 }]
  };
  const orders = [{
    id: "order-53916",
    documents: [{ id: "document-1", url: "/labels/53916.pdf" }],
    shipments: [{
      id: "shipment-1",
      fulfillmentBatchId: batch.id,
      fulfillmentRouteIds: ["route-1"],
      status: "label_purchased",
      trackingNumber: "1ZK11711YW97242170",
      shippingCost: 6.98,
      labelPurchasedAt: "2026-10-13T17:15:07.494Z",
      documents: [{ documentType: "shipping_label", documentId: "document-1" }]
    }]
  }];

  const result = await reconcileFulfillmentBatchPurchaseEvidence(state, batch, orders);
  assert.equal(result.changed, 1);
  assert.equal(batch.rows[0].status, "purchased");
  assert.equal(batch.rows[0].documentId, "document-1");
  assert.equal(batch.rows[0].shipmentId, "shipment-1");
  assert.equal(batch.rows[0].trackingNumber, "1ZK11711YW97242170");
  assert.equal(batch.rows[0].shippingCost, 6.98);
  assert.equal(state.printQueue[0].documentCount, 1);
  assert.equal(state.printQueue[0].orderCount, 1);
  assert.deepEqual(state.printQueue[0].documentIds, ["document-1"]);
  assert.equal(state.printQueue[0].documentManifestFinalized, true);

  const exposedPacket = {
    id: "print-exposed",
    batchId: batch.id,
    status: "ready",
    routeIds: [],
    documentIds: ["document-original"],
    documentManifestLocked: true,
    lastGeneratedAt: "2026-10-13T18:00:00.000Z"
  };
  state.printQueue.push(exposedPacket);
  batch.rows.push({
    orderId: "order-53917",
    orderNumber: "53917",
    routeIds: ["route-2"],
    status: "failed"
  });
  orders.push({
    id: "order-53917",
    documents: [{ id: "document-late", url: "/labels/53917.pdf" }],
    shipments: [{
      id: "shipment-2",
      fulfillmentBatchId: batch.id,
      fulfillmentRouteIds: ["route-2"],
      status: "label_purchased",
      trackingNumber: "9400111899223856928499",
      shippingCost: 7.25,
      documents: [{ documentType: "shipping_label", documentId: "document-late" }]
    }]
  });
  await reconcileFulfillmentBatchPurchaseEvidence(state, batch, orders);
  assert.equal(batch.rows[1].status, "purchased");
  assert.deepEqual(exposedPacket.documentIds, ["document-original"], "an exposed print packet must remain immutable");

  const unchanged = await reconcileFulfillmentBatchPurchaseEvidence(state, batch, orders);
  assert.equal(unchanged.changed, 0, "reconciliation should be idempotent");

  console.log("fulfillment batch purchase reconciliation tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
