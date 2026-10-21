const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { stateDocumentKeys } = require("../db");

test("fulfillment operations state is registered for durable PostgreSQL writes", () => {
  const keys = new Set(stateDocumentKeys);
  for (const key of [
    "fulfillmentLabelBatches",
    "fulfillmentPrintQueue",
    "fulfillmentDeploymentGate",
    "fulfillmentPrintStations",
    "fulfillmentManifests",
    "fulfillmentOperationsSettings"
  ]) {
    assert.equal(keys.has(key), true, `${key} must be persisted by writeStateDocuments`);
  }
});

test("fulfillment operational records are stored as independently updatable entity documents", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
  const collectionBlock = source.match(/const ENTITY_DOCUMENT_COLLECTIONS = new Set\(\[([\s\S]*?)\]\);/);

  assert.ok(collectionBlock, "entity document collection registry must exist");
  assert.match(collectionBlock[1], /"fulfillmentPrintStations"/);
  assert.match(collectionBlock[1], /"fulfillmentLabelBatches"/);
  assert.match(collectionBlock[1], /"fulfillmentPrintQueue"/);
  assert.match(source, /async function listFulfillmentShippingBatches/);
  assert.match(source, /from entity_documents[\s\S]*collection = 'fulfillmentLabelBatches'/);
});

test("operational history collections use differential row upserts", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
  const appendSafeBlock = source.match(/const APPEND_SAFE_ENTITY_DOCUMENT_COLLECTIONS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(appendSafeBlock, "append-safe entity collection registry must exist");
  for (const key of ["inventoryLedger", "returns", "fulfillmentLabelBatches", "fulfillmentPrintQueue"]) {
    assert.match(appendSafeBlock[1], new RegExp(`"${key}"`));
  }
  assert.match(source, /entity_documents\.data is distinct from excluded\.data/);
});

test("shipping batch reads are paged and do not reconcile or write", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = server.indexOf('url.pathname === "/api/fulfillment/shipping-batches"');
  const end = server.indexOf('url.pathname === "/api/fulfillment/diagnostics"', start);
  assert.ok(start >= 0 && end > start, "shipping batches route must exist");
  const route = server.slice(start, end);
  assert.match(route, /listFulfillmentShippingBatches/);
  assert.doesNotMatch(route, /reconcileFulfillmentBatchPurchaseEvidence/);
  assert.doesNotMatch(route, /writeStateDocuments/);
});
