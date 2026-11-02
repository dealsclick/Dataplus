const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dbSource = fs.readFileSync(path.join(root, "db.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");

test("order summaries preserve consolidation identity and label evidence", () => {
  const summaryMapper = dbSource.slice(dbSource.indexOf("function orderRowToSummary"), dbSource.indexOf("async function listOrders"));
  assert.match(summaryMapper, /customerId: row\.customer_id \|\| raw\.customerId \|\| ""/);
  assert.match(dbSource, /'customerId', summary_raw\.external->>'customerId'/);
  assert.match(dbSource, /'buyerId', summary_raw\.external->>'buyerId'/);
  assert.match(dbSource, /'documents', case when jsonb_typeof\(shipment->'documents'\) = 'array'/);
  assert.match(dbSource, /'shipmentGroupId', shipment->'shipmentGroupId'/);
  assert.match(dbSource, /'sharedLabel', shipment->'sharedLabel'/);
});

test("candidate lookup uses stable buyer identity without an age cutoff", () => {
  assert.match(serverSource, /const candidateIdentity = String\(order\.customerId[\s\S]*order\.buyer/);
  assert.match(serverSource, /listOrders\(\{ limit: 5000, summary: true, q: candidateIdentity, openWorkOnly: true \}\)/);
  assert.match(serverSource, /timeLimitEnforced: false/);
  assert.doesNotMatch(serverSource, /const dateFrom = new Date\(primaryTimestamp - windowMs\)/);
});

test("active and purchased label rows are excluded from consolidation", () => {
  assert.match(serverSource, /function protectedShipmentConsolidationOrderIds/);
  assert.match(serverSource, /"queued", "processing", "label_pending", "purchased"/);
  assert.match(serverSource, /A label purchase is already active or recorded for this order/);
});
