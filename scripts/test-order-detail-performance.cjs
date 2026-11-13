const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").replace(/\r\n/g, "\n");
const database = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8").replace(/\r\n/g, "\n");
const appSource = ["App.tsx", "components/order-detail-route.tsx"].map((file) => fs.readFileSync(path.join(__dirname, "..", "web", "src", ...file.split("/")), "utf8")).join("\n").replace(/\r\n/g, "\n");
const routeStart = source.indexOf('if (req.method === "GET" && parts[0] === "api" && parts[1] === "orders" && parts[2] && parts[2] !== "tracking-lookup"');
const routeEnd = source.indexOf('\n  if (req.method === "GET"', routeStart + 1);
const route = source.slice(routeStart, routeEnd);
const cacheStart = source.indexOf('function clearOrderApiCache(');
const cacheEnd = source.indexOf('\nfunction ', cacheStart + 1);
const cache = source.slice(cacheStart, cacheEnd);

assert.ok(routeStart >= 0 && routeEnd > routeStart, "order-detail route must exist");
assert.match(route, /postgres\.readOrderReturns\(order\)/, "order detail must query only returns related to the selected order");
assert.doesNotMatch(route, /readStateField\("returns"\)/, "order detail must not load the global returns document");
assert.match(route, /Promise\.all\(\[\s*postgres\.readOrderCustomerSummary\(order\),[\s\S]*enrichOrderDetail\(order\)/, "optional order enrichment should run concurrently");
assert.match(cache, /dataplus:order-detail:v9:\$\{orderId\}:/, "writes must invalidate only the changed order detail");
assert.doesNotMatch(cache, /deleteByPrefix\("dataplus:order-detail:"\)/, "writes must not flush every cached order detail");
assert.ok(appSource.includes('if (/^\\/orders\\/[^/]+\\/?$/.test(window.location.pathname)) { setLoading(false); return }'), "order details must not load the global application state");
assert.match(source, /const omitOrders = lite && !includeOrders;/, "lite shell state must omit orders unless a caller explicitly requests them");
assert.match(appSource, /Array\.isArray\(shipment\.packages\) \? shipment\.packages\[0\] \|\| \{\} : \{\}/, "order details must tolerate shipments whose package list is empty");
assert.match(appSource, /Unable to load order[\s\S]*Retry/, "request failures must not be presented as missing orders");

const readOrderStart = database.indexOf("async function readOrderByKey(key)");
const readOrderEnd = database.indexOf("async function readOrderFinancialSummary", readOrderStart);
const readOrder = database.slice(readOrderStart, readOrderEnd);
assert.match(readOrder, /const isHumanOrderNumber = \/\^\\d\{4,10\}\$\//, "human order numbers must use their index before UUID lookup");
assert.match(readOrder, /const indexedIdentifiers = isHumanOrderNumber/, "order references must retain indexed identifier fallbacks");
assert.doesNotMatch(readOrder, /where lower\(order_number\)[\s\S]{0,300}or lower\(coalesce\(raw->'external'/, "indexed order numbers must not share an OR predicate with JSON fallbacks");

const productLookupStart = database.indexOf("async function readProductsForOrderSkus(keys = [], options = {})");
const productLookupEnd = database.indexOf("async function listProducts", productLookupStart);
const productLookup = database.slice(productLookupStart, productLookupEnd);
assert.match(productLookup, /if \(fast\) \{[\s\S]*where lower\(sku\) = any\(\$1\)[\s\S]*const unresolved = normalized\.filter/, "order details must resolve exact SKU and aliases before broader identifiers");
assert.match(productLookup, /if \(unresolved\.length\)/, "the fast lookup must skip broad identifier tables when exact matches resolve every key");
assert.match(productLookup, /identifier_type = any\(array\[/, "fallback identifier lookup must preserve the identifier-type index");
assert.match(route, /redisCache\.setJson\(requestedCacheKey, payload, 60\)/, "human order-number lookups should receive a short alias cache");
assert.match(route, /enrichOrderDetail\(order\)/, "order detail enrichment must remain enabled");
assert.match(source, /readProductsForOrderSkus\(keys, \{ fast: true \}\)/, "order detail enrichment must use the indexed product lookup");
assert.match(source, /orderLineSkuLookupKeys\(lines, \{ preferredOnly: true \}\)/, "order details must not re-scan a line's channel identifiers after its catalog SKU resolves");
assert.match(source, /if \(products\.length\) return products;/, "broader line identifiers must remain a fallback only when the preferred SKU is unresolved");

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
