const assert = require("node:assert/strict");
const { Pool } = require("pg");

const databaseUrl = String(process.env.FULFILLMENT_STORAGE_TEST_DATABASE_URL || "").trim();
if (!/_fulfillment_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error("FULFILLMENT_STORAGE_TEST_DATABASE_URL must point to an isolated database ending in _fulfillment_test.");
}

process.env.DATABASE_URL = databaseUrl;
process.env.DATAPLUS_DISABLE_POSTGRES = "0";
delete process.env.DATAPLUS_DOCKER;

const postgres = require("../db");

const batch = {
  id: "batch-1200",
  batchNumber: "BATCH-1200",
  status: "completed",
  phase: "purchase",
  warehouseStatus: "open",
  printPacketStatus: "completed",
  createdBy: "Storage test",
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-21T12:00:00.000Z",
  warehouseStatusHistory: [{ status: "open", changedAt: "2026-10-20T12:00:00.000Z", changedBy: "Storage test" }],
  labelPrintHistory: [{ attemptId: "attempt-1", printedAt: "2026-10-21T10:00:00.000Z", printedBy: "Storage test" }],
  labelPdfSaveHistory: [{ saveId: "save-1", savedAt: "2026-10-21T11:00:00.000Z", savedBy: "Storage test" }],
  rows: [{
    id: "batch-row-1",
    orderId: "order-1",
    orderNumber: "55001",
    customer: "Test Customer",
    channel: "eBay",
    routeId: "route-1",
    routeIds: ["route-1"],
    skus: ["SKU-1"],
    status: "purchased",
    documentId: "document-1",
    shipmentId: "shipment-1",
    trackingNumber: "9400000000000000000000",
    shippingCost: 8.25,
    selectedRate: { id: "rate-1", provider: "veeqo", carrier: "USPS", service: "Ground Advantage", amount: 8.25 },
    rates: [{ id: "rate-1", provider: "veeqo", carrier: "USPS", service: "Ground Advantage", amount: 8.25 }],
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-21T12:00:00.000Z"
  }]
};

const printJob = {
  id: "print-job-1200",
  printNumber: "PRINT-1200",
  batchId: batch.id,
  batchNumber: batch.batchNumber,
  status: "queued",
  deliveryStatus: "queued",
  stationId: "station-1",
  documentIds: ["document-1"],
  printHistory: [{ attemptId: "attempt-1", printedAt: "2026-10-21T10:00:00.000Z", printedBy: "Storage test" }],
  savedPdfHistory: [{ saveId: "save-1", savedAt: "2026-10-21T11:00:00.000Z", savedBy: "Storage test" }],
  createdAt: "2026-10-20T12:00:00.000Z",
  updatedAt: "2026-10-21T12:00:00.000Z"
};

async function main() {
  const setup = new Pool({ connectionString: databaseUrl });
  await setup.query("drop schema public cascade");
  await setup.query("create schema public");
  await setup.query(`
    create table state_documents (
      doc_key text primary key,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    )
  `);
  await setup.query("insert into state_documents (doc_key, data) values ($1, $2::jsonb), ($3, $4::jsonb)", [
    "fulfillmentLabelBatches", JSON.stringify([batch]),
    "fulfillmentPrintQueue", JSON.stringify([printJob])
  ]);
  await setup.end();

  await postgres.initDatabase();
  const pool = postgres.getPool();
  const counts = await pool.query(`
    select
      (select count(*)::int from fulfillment_label_batches) as batches,
      (select count(*)::int from fulfillment_label_batch_rows) as batch_rows,
      (select count(*)::int from fulfillment_batch_events) as batch_events,
      (select count(*)::int from fulfillment_print_jobs) as print_jobs,
      (select count(*)::int from fulfillment_print_job_documents) as print_documents,
      (select count(*)::int from fulfillment_print_events) as print_events,
      (select count(*)::int from entity_documents where collection in ('fulfillmentLabelBatches','fulfillmentPrintQueue')) as legacy_entities
  `);
  assert.deepEqual(counts.rows[0], {
    batches: 1,
    batch_rows: 1,
    batch_events: 3,
    print_jobs: 1,
    print_documents: 1,
    print_events: 2,
    legacy_entities: 0
  });

  let storedBatch = await postgres.readStateArrayItem("fulfillmentLabelBatches", batch.id);
  assert.equal(storedBatch.batchNumber, batch.batchNumber);
  assert.equal(storedBatch.rows[0].trackingNumber, batch.rows[0].trackingNumber);
  assert.equal(storedBatch.rows[0].selectedRate.service, "Ground Advantage");
  assert.equal(storedBatch.warehouseStatusHistory.length, 1);
  assert.equal(storedBatch.labelPrintHistory.length, 1);
  assert.equal(storedBatch.labelPdfSaveHistory.length, 1);

  const storedJobs = await postgres.readFulfillmentPrintJobsForOrders([], [batch.id]);
  assert.equal(storedJobs.length, 1);
  assert.deepEqual(storedJobs[0].documentIds, ["document-1"]);
  assert.equal(storedJobs[0].printHistory.length, 1);
  assert.equal(storedJobs[0].savedPdfHistory.length, 1);

  const search = await postgres.listFulfillmentShippingBatches({ query: "SKU-1", page: 1, pageSize: 25 });
  assert.equal(search.total, 1);
  assert.equal(search.batches[0].rows[0].orderNumber, "55001");

  const exceptionBatch = await postgres.readFulfillmentBatchByExceptionId("batch-batch-1200-batch-row-1");
  assert.equal(exceptionBatch.id, batch.id);
  assert.equal(exceptionBatch.rows[0].id, batch.rows[0].id);

  await postgres.mutateStateArrayItem("fulfillmentLabelBatches", batch.id, (current) => {
    current.rows[0].pickedBy = "Warehouse user";
    current.rows[0].updatedAt = "2026-10-21T12:05:00.000Z";
    current.updatedAt = "2026-10-21T12:05:00.000Z";
    return { row: current };
  });
  storedBatch = await postgres.readStateArrayItem("fulfillmentLabelBatches", batch.id);
  assert.equal(storedBatch.rows[0].pickedBy, "Warehouse user");

  await postgres.writeStateDocuments({
    fulfillmentLabelBatches: [{ ...storedBatch, status: "stale-overwrite", updatedAt: "2026-10-20T12:00:00.000Z" }]
  });
  storedBatch = await postgres.readStateArrayItem("fulfillmentLabelBatches", batch.id);
  assert.equal(storedBatch.status, "completed");

  const claimed = await postgres.claimFulfillmentPrintJob("station-1", (current) => {
    current.deliveryStatus = "claimed";
    current.status = "printing";
    current.updatedAt = "2026-10-21T12:10:00.000Z";
    return { row: current, result: "claimed" };
  });
  assert.equal(claimed.result, "claimed");
  assert.equal(claimed.row.documentIds[0], "document-1");
  const claimedStored = await postgres.readStateArrayItem("fulfillmentPrintQueue", printJob.id);
  assert.equal(claimedStored.deliveryStatus, "claimed");

  assert.equal(await postgres.nextFulfillmentBatchNumberAtomic("BATCH"), "BATCH-1201");
  assert.equal(await postgres.nextFulfillmentPrintNumberAtomic("BATCH-1200"), "PRINT-1200-02");

  await postgres.closePool();
  console.log("PASS fulfillment storage migration and PostgreSQL adapters");
}

main().catch(async (error) => {
  await postgres.closePool().catch(() => {});
  console.error(error);
  process.exitCode = 1;
});
