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

test("fulfillment operational records use dedicated relational tables", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
  const collectionBlock = source.match(/const ENTITY_DOCUMENT_COLLECTIONS = new Set\(\[([\s\S]*?)\]\);/);
  const normalizedBlock = source.match(/const NORMALIZED_FULFILLMENT_COLLECTIONS = new Set\(\[([\s\S]*?)\]\);/);

  assert.ok(collectionBlock, "entity document collection registry must exist");
  assert.ok(normalizedBlock, "normalized fulfillment collection registry must exist");
  assert.match(collectionBlock[1], /"fulfillmentPrintStations"/);
  assert.doesNotMatch(collectionBlock[1], /"fulfillmentLabelBatches"/);
  assert.doesNotMatch(collectionBlock[1], /"fulfillmentPrintQueue"/);
  assert.match(normalizedBlock[1], /"fulfillmentLabelBatches"/);
  assert.match(normalizedBlock[1], /"fulfillmentPrintQueue"/);
  for (const table of ["fulfillment_label_batches", "fulfillment_label_batch_rows", "fulfillment_batch_events", "fulfillment_print_jobs", "fulfillment_print_job_documents", "fulfillment_print_events"]) {
    assert.match(source, new RegExp(`create table if not exists ${table}`));
  }
  assert.match(source, /async function listFulfillmentShippingBatches/);
  assert.match(source, /from fulfillment_label_batches batches/);
});

test("normalized fulfillment writes are differential and stale-safe", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
  const appendSafeBlock = source.match(/const APPEND_SAFE_ENTITY_DOCUMENT_COLLECTIONS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(appendSafeBlock, "append-safe entity collection registry must exist");
  for (const key of ["inventoryLedger", "returns"]) {
    assert.match(appendSafeBlock[1], new RegExp(`"${key}"`));
  }
  assert.match(source, /existingVersions\.get\(`\$\{row\.collection\}\\u0000\$\{entityId\}`\)/);
  assert.match(source, /Date\.parse\(incomingVersion\) > Date\.parse\(existingVersion\)/);
  assert.match(source, /migrateLegacyFulfillmentDocuments\(client\)/);
  assert.match(source, /delete from entity_documents where collection = \$1 and entity_id = \$2/);
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

test("unrelated state reads do not hydrate fulfillment history", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
  const categoryReader = source.match(/async function readCategoryState\(\) \{([\s\S]*?)\n\}/);
  assert.ok(categoryReader, "category state reader must exist");
  assert.doesNotMatch(categoryReader[1], /readStateDocuments\(\)/);
  assert.match(categoryReader[1], /readStateFields\(\["categorySettings", "vendorCategoryMappings"\]/);

  const relationalReader = source.match(/async function readRelationalState\(options = \{\}\) \{([\s\S]*?)\n\}/);
  assert.ok(relationalReader, "relational state reader must exist");
  const defaultFields = relationalReader[1].match(/const stateFields = \[([\s\S]*?)\];/);
  assert.ok(defaultFields, "default relational state fields must exist");
  assert.doesNotMatch(defaultFields[1], /fulfillmentLabelBatches|fulfillmentPrintQueue/);
});

test("fulfillment request paths use targeted normalized reads", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.doesNotMatch(source, /readFulfillmentOperationsState/);
  assert.doesNotMatch(source, /readStateField\("fulfillmentLabelBatches"/);
  assert.doesNotMatch(source, /readStateField\("fulfillmentPrintQueue"/);
  assert.match(source, /readFulfillmentLabelPurchaseState/);
  assert.match(source, /readFulfillmentPrintPacketState/);
  assert.match(source, /readFulfillmentBatchesByOrderIds/);
  assert.match(source, /readFulfillmentBatchByExceptionId/);
});
