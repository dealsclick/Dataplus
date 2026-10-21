const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const database = fs.readFileSync(path.join(root, "db.js"), "utf8");
const purchasing = fs.readFileSync(path.join(root, "web", "src", "components", "purchasing-route.tsx"), "utf8");

const legacyStart = server.indexOf('url.pathname === "/api/fulfillment/work"');
const legacyEnd = server.indexOf('url.pathname === "/api/fulfillment/shipping-batches"', legacyStart);
assert.ok(legacyStart >= 0 && legacyEnd > legacyStart, "legacy fulfillment route must remain explicit");
const legacyRoute = server.slice(legacyStart, legacyEnd);
assert.match(legacyRoute, /sendJson\(res, 410/);
assert.doesNotMatch(legacyRoute, /listOrders/);
assert.doesNotMatch(legacyRoute, /listPurchaseOrders/);

const pickStart = server.indexOf('url.pathname === "/api/fulfillment/pick-list"');
const pickEnd = server.indexOf('url.pathname === "/api/purchasing/receiving-search"', pickStart);
assert.ok(pickStart >= 0 && pickEnd > pickStart, "pick-list print route must exist");
const pickRoute = server.slice(pickStart, pickEnd);
assert.match(pickRoute, /listFulfillmentPickRows/);
assert.doesNotMatch(pickRoute, /listOrders\(\{ limit: 5000 \}\)/);
assert.match(pickRoute, /X-DataPlus-Query-Ms/);

const createPickStart = server.indexOf('req.method === "POST" && ["/api/fulfillment/pick-lists"');
const createPickEnd = server.indexOf('parts[2] === "pick-lists"', createPickStart);
assert.ok(createPickStart >= 0 && createPickEnd > createPickStart, "pick-list creation route must exist");
const createPickRoute = server.slice(createPickStart, createPickEnd);
assert.match(createPickRoute, /readOrdersByFulfillmentRouteIds/);
assert.doesNotMatch(createPickRoute, /listOrders\(\{ limit: 5000 \}\)/);

const supplierStart = server.indexOf('url.pathname === "/api/purchasing/supplier-returns"');
const supplierEnd = server.indexOf('url.pathname === "/api/purchasing/tools/external-po"', supplierStart);
assert.ok(supplierStart >= 0 && supplierEnd > supplierStart, "supplier returns route must exist");
const supplierRoute = server.slice(supplierStart, supplierEnd);
assert.match(supplierRoute, /listSupplierReturns/);
assert.doesNotMatch(supplierRoute, /listPurchaseOrders/);
assert.match(supplierRoute, /X-DataPlus-Query-Ms/);

assert.match(database, /async function listSupplierReturns/);
assert.match(database, /jsonb_array_elements\([\s\S]*purchase_order\.raw->'returns'/);
assert.match(database, /order_records_fulfillment_routes_gin_idx/);
assert.match(database, /async function readOrdersByFulfillmentRouteIds/);
assert.match(database, /async function listFulfillmentPickRows/);
assert.match(purchasing, /first\.pagination\?\.totalPages/);

console.log("Operational read performance checks passed.");
