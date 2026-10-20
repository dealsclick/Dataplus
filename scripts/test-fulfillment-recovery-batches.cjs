const assert = require("node:assert/strict");
const {
  createFulfillmentRecoveryBatch,
  ensureFulfillmentBatchPrintJob,
  fulfillmentBatchesNeedingPrintPacketRecovery,
  fulfillmentPrintJobHasOutput,
  fulfillmentPrintJobOutstandingRows
} = require("../server");

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

  const assemblingBatch = {
    id: "assembling-batch",
    batchNumber: "BATCH-1101",
    printSize: "4x6",
    includePackingSlips: true,
    rows: [
      { orderId: "order-1", routeIds: ["route-1"], status: "purchased", documentId: "document-1" },
      { orderId: "order-2", routeIds: ["route-2"], status: "label_pending", documentId: "" }
    ]
  };
  const assemblingJob = {
    id: "print-assembling",
    batchId: assemblingBatch.id,
    batchNumber: assemblingBatch.batchNumber,
    printRequestId: "request-1",
    routeIds: [],
    documentIds: ["document-1"],
    documentManifestLocked: true,
    status: "ready"
  };
  const assemblingState = { batches: [assemblingBatch], printQueue: [assemblingJob] };
  await ensureFulfillmentBatchPrintJob(assemblingState, assemblingBatch, [], "request-1", "Test");
  assert.equal(assemblingJob.status, "waiting_for_labels");
  assert.equal(assemblingJob.documentManifestFinalized, false);
  assert.equal(assemblingJob.outstandingDocumentCount, 1);
  assert.equal(fulfillmentPrintJobOutstandingRows(assemblingBatch, assemblingJob).length, 1);

  Object.assign(assemblingBatch.rows[1], { status: "purchased", documentId: "document-2" });
  await ensureFulfillmentBatchPrintJob(assemblingState, assemblingBatch, [], "request-1", "Test");
  assert.deepEqual(assemblingJob.documentIds, ["document-1", "document-2"]);
  assert.equal(assemblingJob.status, "ready");
  assert.equal(assemblingJob.documentManifestFinalized, true);

  assemblingJob.lastGeneratedAt = "2026-10-15T18:00:00.000Z";
  assemblingBatch.rows.push({ orderId: "order-3", routeIds: ["route-3"], status: "purchased", documentId: "document-3" });
  await ensureFulfillmentBatchPrintJob(assemblingState, assemblingBatch, [], "request-1", "Test");
  assert.equal(fulfillmentPrintJobHasOutput(assemblingJob, assemblingBatch), true);
  assert.deepEqual(assemblingJob.documentIds, ["document-1", "document-2"], "an exposed packet must remain immutable");

  const missingPacketBatch = {
    id: "missing-packet-batch",
    batchNumber: "BATCH-1116",
    phase: "purchase",
    status: "completed",
    createdAt: "2026-10-19T15:00:00.000Z",
    rows: [{ orderId: "order-4", status: "purchased", documentId: "document-4" }]
  };
  const recoveryCandidates = fulfillmentBatchesNeedingPrintPacketRecovery({ batches: [missingPacketBatch], printQueue: [] }, {
    now: new Date("2026-10-19T18:00:00.000Z").getTime()
  });
  assert.deepEqual(recoveryCandidates.map((batch) => batch.batchNumber), ["BATCH-1116"]);
  assert.equal(fulfillmentBatchesNeedingPrintPacketRecovery({
    batches: [missingPacketBatch],
    printQueue: [{ batchId: missingPacketBatch.id }]
  }, { now: new Date("2026-10-19T18:00:00.000Z").getTime() }).length, 0, "existing packets must not be duplicated");
  assert.equal(fulfillmentBatchesNeedingPrintPacketRecovery({
    batches: [{ ...missingPacketBatch, warehouseStatus: "closed" }],
    printQueue: []
  }, { now: new Date("2026-10-19T18:00:00.000Z").getTime() }).length, 0, "closed warehouse batches must stay closed");
  assert.equal(fulfillmentBatchesNeedingPrintPacketRecovery({
    batches: [{ ...missingPacketBatch, createdAt: "2025-01-01T00:00:00.000Z" }],
    printQueue: []
  }).length, 0, "historical batches must not enter automatic startup recovery");

  console.log("fulfillment recovery batch tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
