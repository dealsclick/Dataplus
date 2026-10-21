const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const database = fs.readFileSync(path.join(root, "db.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

function section(startText, endText) {
  const start = server.indexOf(startText);
  const end = server.indexOf(endText, start + startText.length);
  assert.ok(start >= 0, `Missing section start: ${startText}`);
  assert.ok(end > start, `Missing section end: ${endText}`);
  return server.slice(start, end);
}

const ratePreparation = section("async function prepareFulfillmentRateRefresh", "async function runFulfillmentRateRefresh");
assert.match(ratePreparation, /readOrdersByFulfillmentRouteIds/);
assert.match(ratePreparation, /readFulfillmentPurchaseOrdersForOrders/);
assert.doesNotMatch(ratePreparation, /listOrders\(\{ limit: 5000/);
assert.doesNotMatch(ratePreparation, /listPurchaseOrders\(\{ limit: 5000/);

const rateMutation = section('parts[2] === "rates" && parts[3]', 'url.pathname === "/api/fulfillment/label-batches"');
assert.match(rateMutation, /readOrdersByFulfillmentRouteIds\(\[parts\[3\]\]\)/);
assert.doesNotMatch(rateMutation, /listOrders\(\{ limit: 5000/);

const labelBatch = section('url.pathname === "/api/fulfillment/label-batches"', 'parts[2] === "label-batches" && parts[3] && parts[4] === "rows"');
assert.match(labelBatch, /readOrdersByFulfillmentRouteIds\(routeIds\)/);
assert.match(labelBatch, /readFulfillmentPurchaseOrdersForOrders\(orders\)/);
assert.doesNotMatch(labelBatch, /listOrders\(\{ limit: 5000/);
assert.doesNotMatch(labelBatch, /listPurchaseOrders\(\{ limit: 5000/);

const manifestRoute = section('url.pathname === "/api/fulfillment/manifests"', 'parts[0] === "api" && parts[1] === "fulfillment" && parts[2] === "manifests"');
assert.match(manifestRoute, /listManifestShipments\(\{ carrier, shipDate \}\)/);
assert.doesNotMatch(manifestRoute, /listOrders\(\{ limit: 5000/);

const groupPreview = section('parts[4] === "cartonization-preview"', 'parts[3] === "shipment-group" && !parts[4]');
assert.match(groupPreview, /readFulfillmentPurchaseOrdersForOrders\(groupOrders\)/);
assert.doesNotMatch(groupPreview, /listPurchaseOrders\(\{ limit: 5000/);

const groupMutation = section('parts[3] === "shipment-group" && !parts[4]', 'parts[4] === "apply-shipment"');
assert.match(groupMutation, /readFulfillmentPurchaseOrdersForOrders\(groupOrders\)/);
assert.match(groupMutation, /readOrdersByShipmentGroupId\(groupId\)/);
assert.doesNotMatch(groupMutation, /listOrders\(\{ limit: 5000/);
assert.doesNotMatch(groupMutation, /listPurchaseOrders\(\{ limit: 5000/);

assert.match(database, /async function readOrdersByShipmentGroupId/);
assert.match(database, /order_records_shipment_group_idx/);
assert.match(database, /async function listManifestShipments/);
assert.match(database, /from order_shipment_financials/);
assert.match(database, /order_shipment_financials_manifest_lookup_idx/);
assert.match(database, /raw->>'createdAt'/);

console.log("Fulfillment action performance checks passed.");
