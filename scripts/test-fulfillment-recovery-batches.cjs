const assert = require("node:assert/strict");
const {
  createFulfillmentRecoveryBatch,
  ensureFulfillmentBatchPrintJob,
  fulfillmentBatchesNeedingPrintPacketRecovery,
  fulfillmentPrintJobHasOutput,
  fulfillmentPrintJobOutstandingRows,
  temuLabelRecoveryRowEligible
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
  assert.equal(created.batch.printPacketStatus, "completed");
  assert.equal(created.batch.sourceBatchNumber, "BATCH-1097");
  assert.deepEqual(created.batch.rows.map((row) => row.orderNumber), ["54980", "54973"]);
  assert.deepEqual(created.printJob.documentIds, ["document-1", "document-2"]);
  assert.equal(created.printJob.documentManifestLocked, true);
  assert.equal(created.printJob.documentManifestFinalized, true);
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
  assert.equal(assemblingBatch.printPacketStatus, "incomplete");
  assert.equal(assemblingJob.outstandingDocumentCount, 1);
  assert.equal(fulfillmentPrintJobOutstandingRows(assemblingBatch, assemblingJob).length, 1);

  Object.assign(assemblingBatch.rows[1], { status: "purchased", documentId: "document-2" });
  await ensureFulfillmentBatchPrintJob(assemblingState, assemblingBatch, [], "request-1", "Test");
  assert.deepEqual(assemblingJob.documentIds, ["document-1", "document-2"]);
  assert.equal(assemblingJob.status, "ready");
  assert.equal(assemblingJob.documentManifestFinalized, true);
  assert.equal(assemblingBatch.printPacketStatus, "completed");

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
    printPacketStatus: "incomplete",
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
  }, { now: new Date("2026-10-19T18:00:00.000Z").getTime() }).length, 1, "an explicitly incomplete packet remains recoverable until finalized");
  assert.equal(fulfillmentBatchesNeedingPrintPacketRecovery({
    batches: [{ ...missingPacketBatch, warehouseStatus: "closed" }],
    printQueue: []
  }, { now: new Date("2026-10-19T18:00:00.000Z").getTime() }).length, 0, "closed warehouse batches must stay closed");
  assert.equal(fulfillmentBatchesNeedingPrintPacketRecovery({
    batches: [{ ...missingPacketBatch, createdAt: "2025-01-01T00:00:00.000Z" }],
    printQueue: []
  }).length, 1, "explicit packet state, not age, controls recovery");
  assert.equal(fulfillmentBatchesNeedingPrintPacketRecovery({
    batches: [{ ...missingPacketBatch, printPacketStatus: "completed" }],
    printQueue: []
  }).length, 0, "completed packets must never enter recovery");
  assert.equal(fulfillmentBatchesNeedingPrintPacketRecovery({
    batches: [{ ...missingPacketBatch, printPacketStatus: undefined }],
    printQueue: []
  }).length, 0, "legacy batches without an explicit incomplete marker must not enter automatic recovery");

  const raceBatch = {
    id: "race-batch",
    batchNumber: "BATCH-1138",
    printSize: "4x6",
    includePackingSlips: true,
    rows: [
      { orderId: "order-5", routeIds: ["route-5"], status: "purchased", documentId: "document-5" },
      { orderId: "order-6", routeIds: ["route-6"], status: "label_pending", documentId: "" }
    ]
  };
  const requestedPacket = {
    id: "requested-packet",
    batchId: raceBatch.id,
    batchNumber: raceBatch.batchNumber,
    printRequestId: "request-1138",
    routeIds: ["route-5", "route-6"],
    documentIds: ["document-5"],
    status: "waiting_for_labels"
  };
  const startupState = { batches: [raceBatch], printQueue: [requestedPacket] };
  const startupPacket = await ensureFulfillmentBatchPrintJob(startupState, raceBatch, [], "", "Startup Temu label recovery");
  assert.equal(startupPacket.id, requestedPacket.id, "startup recovery must reuse the active purchase packet");
  assert.equal(startupPacket.printRequestId, "request-1138");
  assert.deepEqual(startupPacket.routeIds, ["route-5", "route-6"]);
  assert.equal(startupState.printQueue.length, 1, "startup recovery must not create a duplicate packet");

  const unclaimedPacket = {
    id: "startup-packet",
    batchId: raceBatch.id,
    batchNumber: raceBatch.batchNumber,
    printRequestId: "",
    routeIds: [],
    documentIds: ["document-5"],
    status: "waiting_for_labels"
  };
  const resumedState = { batches: [raceBatch], printQueue: [unclaimedPacket] };
  const resumedPacket = await ensureFulfillmentBatchPrintJob(resumedState, raceBatch, ["route-5", "route-6"], "request-1138", "Warehouse user");
  assert.equal(resumedPacket.id, unclaimedPacket.id, "a user request must adopt an unexposed startup packet");
  assert.equal(resumedPacket.printRequestId, "request-1138");
  assert.equal(resumedState.printQueue.length, 1, "resuming a request must not create a duplicate packet");

  const secondRequest = await ensureFulfillmentBatchPrintJob(resumedState, raceBatch, ["route-5"], "request-1138-second", "Warehouse user");
  assert.notEqual(secondRequest.id, resumedPacket.id, "separate explicit purchase requests must keep separate packets");
  assert.equal(resumedState.printQueue.length, 2);

  assert.equal(temuLabelRecoveryRowEligible({
    status: "label_pending",
    selectedRate: { provider: "temu", action: "create_shipment" },
    packageSnList: ["PK-1138"]
  }), true, "a pending Temu document remains eligible for recovery");
  assert.equal(temuLabelRecoveryRowEligible({
    status: "purchased",
    documentId: "document-temu",
    selectedRate: { provider: "temu" }
  }), true, "purchased Temu labels remain eligible for tracking repair");
  assert.equal(temuLabelRecoveryRowEligible({
    status: "rated",
    selectedRate: { provider: "veeqo", carrier: "FedEx" }
  }, { retryUnpurchased: true }), false, "Temu recovery must never rewrite an unfinished Veeqo row");
  assert.equal(temuLabelRecoveryRowEligible({
    status: "rated",
    selectedRate: { provider: "temu", action: "create_shipment" }
  }), false, "startup recovery must not purchase an unstarted Temu row");
  assert.equal(temuLabelRecoveryRowEligible({
    status: "rated",
    selectedRate: { provider: "temu", action: "create_shipment" }
  }, { retryUnpurchased: true }), true, "an explicit retry may resume an unpurchased Temu shipment");

  console.log("fulfillment recovery batch tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
