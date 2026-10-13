const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dbSource = fs.readFileSync(path.join(root, "db.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const deploySource = fs.readFileSync(path.join(root, "scripts", "deploy-production.sh"), "utf8");

test("fulfillment batch and print numbers use database advisory locks", () => {
  assert.match(dbSource, /async function nextFulfillmentBatchNumberAtomic/);
  assert.match(dbSource, /dataplus-\$\{sequenceKey\}/);
  assert.match(dbSource, /async function nextFulfillmentPrintNumberAtomic/);
  assert.doesNotMatch(serverSource, /state\.printQueue\.length \+ 1/);
  assert.doesNotMatch(serverSource, /batchNumber: requestedBatchNumber \|\| `\$\{batchPrefix\}-\$\{highest \+ 1\}`/);
});

test("carrier requests are checkpointed before purchase processing", () => {
  const workerStart = serverSource.indexOf("async function runFulfillmentLabelPurchaseWorkerJob");
  const processCall = serverSource.indexOf("await processFulfillmentBatchRow", workerStart);
  const checkpoint = serverSource.lastIndexOf("purchaseAttemptId = crypto.randomUUID()", processCall);
  const persisted = serverSource.lastIndexOf("await postgres.writeStateDocuments({ fulfillmentLabelBatches", processCall);
  assert.ok(checkpoint > workerStart && checkpoint < processCall);
  assert.ok(persisted > checkpoint && persisted < processCall);
});

test("production deploy drains label purchases before restarting services", () => {
  const drain = deploySource.indexOf("wait-for-label-purchases.cjs --pause");
  const restart = deploySource.indexOf("docker compose up -d");
  assert.ok(drain >= 0 && drain < restart);
  assert.match(deploySource, /wait-for-label-purchases\.cjs --resume/);
  assert.match(serverSource, /reason: "deployment_drain"/);
});
