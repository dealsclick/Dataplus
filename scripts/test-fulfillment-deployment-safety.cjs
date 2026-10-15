const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dbSource = fs.readFileSync(path.join(root, "db.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const appSource = ["App.tsx", "components/fulfillment-route.tsx"].map((file) => fs.readFileSync(path.join(root, "web", "src", ...file.split("/")), "utf8")).join("\n");
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

test("browser print packets use targeted state reads", () => {
  assert.match(dbSource, /async function readStateArrayItem/);
  assert.match(dbSource, /async function replaceStateArrayItem/);
  assert.match(serverSource, /async function readFulfillmentPrintPacketState/);
  const routeStart = serverSource.indexOf('parts[2] === "print-queue" && parts[3] && parts[4] === "document.pdf"');
  const routeEnd = serverSource.indexOf('parts[2] && parts[3] === "shipments"', routeStart);
  const routeSource = serverSource.slice(routeStart, routeEnd);
  assert.match(routeSource, /readFulfillmentPrintPacketState\(parts\[3\]\)/);
  assert.match(routeSource, /cachedFulfillmentPrintPacket/);
  assert.doesNotMatch(routeSource, /readFulfillmentOperationsState/);
  assert.doesNotMatch(routeSource, /writeStateDocuments/);
});

test("purchased-label packets never return a partial PDF", () => {
  assert.match(serverSource, /restorePurchasedLabelReferences/);
  assert.match(serverSource, /Print packet incomplete:/);
  assert.match(serverSource, /No partial packet was returned/);
});

test("late purchased labels use immutable manifests and automatic recovery batches", () => {
  assert.match(serverSource, /documentManifestLocked: true/);
  assert.match(serverSource, /packetManifestLocked/);
  assert.match(serverSource, /async function createFulfillmentRecoveryBatch/);
  assert.match(serverSource, /await createFulfillmentRecoveryBatch\(state, batch, lateRows/);
  assert.match(serverSource, /recoveryOnly: true/);
  assert.match(serverSource, /sourceBatchNumber/);
});

test("Temu imports merge the latest operational order state before saving", () => {
  const flushStart = serverSource.indexOf("const flushTemuOrders = async");
  const flushEnd = serverSource.indexOf("const result = await importTemuOrders", flushStart);
  const flushSource = serverSource.slice(flushStart, flushEnd);
  assert.match(flushSource, /readOrdersByIds\(importableOrders\.map/);
  assert.match(flushSource, /preserveMarketplaceOrderOperations\(incoming, latestById\.get/);
  assert.ok(flushSource.indexOf("readOrdersByIds") < flushSource.indexOf("upsertOrdersFromState"));
});

test("fulfillment console reads an atomically published view projection", () => {
  assert.match(dbSource, /create table if not exists fulfillment_console_projection_meta/);
  assert.match(dbSource, /create table if not exists fulfillment_console_projection_rows/);
  assert.match(dbSource, /async function publishFulfillmentConsoleProjection/);
  assert.match(dbSource, /async function readFulfillmentConsoleProjection/);
  assert.match(serverSource, /readFulfillmentConsoleProjectionView\(view\)/);
  assert.match(serverSource, /publishFulfillmentConsoleProjection\(fulfillmentConsoleProjectionPayload\(snapshot\)\)/);
  assert.doesNotMatch(appSource, /load\(true, true\)/);
  assert.match(appSource, /const load = async \(fresh = false/);
});

test("ordinary fulfillment mutations patch only affected projection rows", () => {
  assert.match(dbSource, /async function patchFulfillmentConsoleProjection/);
  assert.match(dbSource, /async function readFulfillmentBatchesByOrderIds/);
  assert.match(serverSource, /async function buildFulfillmentConsoleOrderProjection/);
  assert.match(serverSource, /async function flushFulfillmentConsoleProjectionPatch/);
  assert.match(serverSource, /invalidateFulfillmentConsoleSnapshot\(orderId \? \[orderId\] : \[\]\)/);
  assert.match(serverSource, /readPurchaseOrdersByIds\(purchaseOrderIds\)/);
});

test("all shipments is paginated in the database projection", () => {
  assert.match(dbSource, /async function readFulfillmentConsoleProjectionPage/);
  assert.match(serverSource, /readFulfillmentConsoleProjectionPage\(\{/);
  assert.match(appSource, /params\.set\("paged", "1"\)/);
  assert.match(appSource, /allShipmentsServerPaged/);
});

test("fulfillment refresh requests return the current projection while rebuilding", () => {
  const routeStart = serverSource.indexOf('url.pathname === "/api/fulfillment/console"');
  const routeEnd = serverSource.indexOf('url.pathname === "/api/fulfillment/tracking/refresh"', routeStart);
  const routeSource = serverSource.slice(routeStart, routeEnd);
  assert.match(routeSource, /void refreshFulfillmentConsoleSnapshot\(\)/);
  assert.match(routeSource, /readFulfillmentConsoleProjectionView/);
  assert.doesNotMatch(routeSource, /await refreshFulfillmentConsoleSnapshot\(\)/);
});
