const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").replace(/\r\n/g, "\n");
const appSource = fs.readFileSync(path.join(__dirname, "..", "web", "src", "App.tsx"), "utf8").replace(/\r\n/g, "\n");
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
assert.ok(appSource.includes('if (/^\\/orders\\/[^/]+\\/?$/.test(window.location.pathname)) { setLoading(false); return }'), "order details must not load the global application state");
assert.match(source, /const omitOrders = lite && !includeOrders;/, "lite shell state must omit orders unless a caller explicitly requests them");

const carriersStart = source.indexOf('url.pathname === "/api/fulfillment/carriers"');
const carriersEnd = source.indexOf('\n  if (req.method', carriersStart + 1);
const carriersRoute = source.slice(carriersStart, carriersEnd);
assert.match(carriersRoute, /readStateField\("fulfillmentOperationsSettings"\)/, "carrier options must read only fulfillment settings");
assert.doesNotMatch(carriersRoute, /readFulfillmentOperationsState\(/, "carrier options must not load batches and print queues");

const ratePrepareStart = source.indexOf("async function prepareFulfillmentRateRefresh(");
const ratePrepareEnd = source.indexOf("\nasync function refreshFulfillmentRateRow(", ratePrepareStart);
const ratePrepare = source.slice(ratePrepareStart, ratePrepareEnd);
assert.match(ratePrepare, /targetOrderIds\.length \? postgres\.readOrdersByIds\(targetOrderIds\)/, "rate workers must hydrate only targeted orders when targets are known");
assert.match(source, /options\.scheduled === true \? 1 : laneName === "temu" \? 2 : 4/, "scheduled rate refreshes must use low concurrency");

console.log("Order-detail performance safeguards passed.");
