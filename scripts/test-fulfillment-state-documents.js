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
    "fulfillmentPrintStations",
    "fulfillmentManifests",
    "fulfillmentOperationsSettings"
  ]) {
    assert.equal(keys.has(key), true, `${key} must be persisted by writeStateDocuments`);
  }
});

test("print stations are stored as independently updatable entity documents", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
  const collectionBlock = source.match(/const ENTITY_DOCUMENT_COLLECTIONS = new Set\(\[([\s\S]*?)\]\);/);

  assert.ok(collectionBlock, "entity document collection registry must exist");
  assert.match(collectionBlock[1], /"fulfillmentPrintStations"/);
});
