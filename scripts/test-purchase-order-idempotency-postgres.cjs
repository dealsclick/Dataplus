const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const connectionString = process.env.DATAPLUS_TEST_DATABASE_URL;
if (!connectionString) throw new Error("Set DATAPLUS_TEST_DATABASE_URL to an isolated local PostgreSQL database ending in _test.");
const databaseUrl = new URL(connectionString);
if (!["localhost", "127.0.0.1"].includes(databaseUrl.hostname) || !databaseUrl.pathname.endsWith("_test")) {
  throw new Error("Use an isolated local PostgreSQL database ending in _test.");
}

process.env.DATABASE_URL = connectionString;
const db = require("../db");

async function main() {
  await db.initRelationalSchema();
  const pool = db.getPool();
  const runId = `${process.pid}-${crypto.randomUUID()}`;
  const requestId = `po-idempotency-${runId}`;
  const requestKey = `manual-po:test-actor:${requestId}`;
  const poIds = [`po-idempotency-a-${runId}`, `po-idempotency-b-${runId}`, `po-idempotency-c-${runId}`];
  const markers = ["first-caller", "second-caller"];
  const createInput = (index) => ({
    purchaseOrders: [{
      id: poIds[index],
      poNumber: `TEST-PO-${index + 1}-${runId}`,
      status: "draft",
      source: "idempotency_test",
      supplier: "Test supplier",
      items: [{ id: `line-${index}-${runId}`, sku: "TEST-SKU", title: "Concurrency test", qty: 1, estimatedUnitCost: 1 }]
    }],
    idempotency: {
      requestKey,
      requestId,
      operation: "manual-po",
      actor: "Test actor",
      response: { marker: markers[index], purchaseOrderId: poIds[index] }
    }
  });

  try {
    const results = await Promise.all([
      db.savePurchaseOrderMutation(createInput(0)),
      db.savePurchaseOrderMutation(createInput(1))
    ]);
    const winnerIndex = results.findIndex((result) => result.replayed === false);
    const replayIndex = results.findIndex((result) => result.replayed === true);
    assert.notEqual(winnerIndex, -1, "one concurrent caller must create the PO");
    assert.notEqual(replayIndex, -1, "one concurrent caller must replay the winner");
    assert.equal(results[replayIndex].response.marker, markers[winnerIndex], "the losing caller must receive the winner's response");

    const persisted = await pool.query("select po_id from purchase_order_records where po_id = any($1::text[])", [poIds]);
    assert.equal(persisted.rowCount, 1, "only one competing PO may be persisted");
    assert.equal(persisted.rows[0].po_id, poIds[winnerIndex]);

    const request = await db.readPurchaseOrderCreationRequest(requestKey);
    assert.equal(request.status, "completed");
    assert.deepEqual(request.purchaseOrderIds, [poIds[winnerIndex]]);
    assert.equal(request.response.marker, markers[winnerIndex]);

    const laterRetry = await db.savePurchaseOrderMutation({
      ...createInput(0),
      purchaseOrders: [{ id: poIds[2], poNumber: `TEST-PO-3-${runId}`, status: "draft", source: "idempotency_test", items: [] }],
      idempotency: { ...createInput(0).idempotency, response: { marker: "later-retry", purchaseOrderId: poIds[2] } }
    });
    assert.equal(laterRetry.replayed, true);
    assert.equal(laterRetry.response.marker, markers[winnerIndex], "later retries must preserve the original response");
    const afterRetry = await pool.query("select count(*)::int as count from purchase_order_records where po_id = any($1::text[])", [poIds]);
    assert.equal(afterRetry.rows[0].count, 1, "a later retry must not create another PO");

    console.log("Concurrent purchase-order idempotency test passed.");
  } finally {
    await pool.query("delete from purchase_order_line_items where po_id = any($1::text[])", [poIds]);
    await pool.query("delete from purchase_order_records where po_id = any($1::text[])", [poIds]);
    await pool.query("delete from purchase_order_creation_requests where request_key = $1", [requestKey]);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.closePool());
