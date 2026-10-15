const assert = require("node:assert/strict");
const { createFulfillmentRecoveryBatch } = require("../server");

async function run() {
  const sourceBatch = {
    id: "source-batch",
    batchNumber: "BATCH-1097",
    printSize: "4x6",
    includePackingSlips: true,
    packingSlipOrientation: "portrait",
    rows: []
  };
  const lateRows = [
    { id: "row-1", orderId: "order-1", orderNumber: "54980", routeIds: ["route-1"], status: "purchased", documentId: "document-1" },
    { id: "row-2", orderId: "order-2", orderNumber: "54973", routeIds: ["route-2"], status: "purchased", documentId: "document-2" }
  ];
  const state = { batches: [sourceBatch], printQueue: [] };
  const created = await createFulfillmentRecoveryBatch(state, sourceBatch, lateRows, "Automatic recovery", {
    batchNumber: "BATCH-1098",
    printNumber: "PRINT-1098"
  });

  assert.equal(created.created, true);
  assert.equal(created.batch.batchNumber, "BATCH-1098");
  assert.equal(created.batch.recoveryOnly, true);
  assert.equal(created.batch.sourceBatchNumber, "BATCH-1097");
  assert.deepEqual(created.batch.rows.map((row) => row.orderNumber), ["54980", "54973"]);
  assert.deepEqual(created.printJob.documentIds, ["document-1", "document-2"]);
  assert.equal(created.printJob.documentManifestLocked, true);
  assert.equal(created.printJob.documentCount, 2);
  assert.equal(state.batches.length, 2);
  assert.equal(state.printQueue.length, 1);

  const repeated = await createFulfillmentRecoveryBatch(state, sourceBatch, [...lateRows].reverse(), "Automatic recovery", {
    batchNumber: "BATCH-9999",
    printNumber: "PRINT-9999"
  });
  assert.equal(repeated.created, false, "the same recovered documents must reuse their recovery batch");
  assert.equal(repeated.batch.batchNumber, "BATCH-1098");
  assert.equal(state.batches.length, 2);
  assert.equal(state.printQueue.length, 1);

  console.log("fulfillment recovery batch tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
