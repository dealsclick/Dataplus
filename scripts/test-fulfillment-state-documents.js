const test = require("node:test");
const assert = require("node:assert/strict");
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
