const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").replace(/\r\n/g, "\n");
const routeStart = source.indexOf('if (req.method === "GET" && parts[0] === "api" && parts[1] === "orders" && parts[2] && !parts[3]');
const routeEnd = source.indexOf('\n  if (req.method === "GET"', routeStart + 1);
const route = source.slice(routeStart, routeEnd);
const cacheStart = source.indexOf('function clearOrderApiCache(');
const cacheEnd = source.indexOf('\nfunction ', cacheStart + 1);
const cache = source.slice(cacheStart, cacheEnd);

assert.ok(routeStart >= 0 && routeEnd > routeStart, "order-detail route must exist");
assert.match(route, /postgres\.readOrderReturns\(order\)/, "order detail must query only returns related to the selected order");
assert.doesNotMatch(route, /readStateField\("returns"\)/, "order detail must not load the global returns document");
assert.match(route, /Promise\.all\(\[\s*postgres\.readOrderCustomerSummary\(order\),[\s\S]*enrichOrderDetail\(order\)/, "optional order enrichment should run concurrently");
assert.match(cache, /dataplus:order-detail:v7:\$\{orderId\}:/, "writes must invalidate only the changed order detail");
assert.doesNotMatch(cache, /deleteByPrefix\("dataplus:order-detail:"\)/, "writes must not flush every cached order detail");

console.log("Order-detail performance safeguards passed.");
