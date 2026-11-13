const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const database = fs.readFileSync(path.join(root, "db.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

const listStart = database.indexOf("async function listOrders(options = {})");
const listEnd = database.indexOf("async function listOpenMarketplaceOrderStatusCandidates", listStart);
assert.ok(listStart >= 0 && listEnd > listStart, "listOrders must remain available");
const listOrders = database.slice(listStart, listEnd);

const boundedRows = listOrders.indexOf("select ${filteredCountSelect} order_records.*");
const boundedLimit = listOrders.indexOf("limit $${limitParameter}", boundedRows);
const summaryProjection = listOrders.indexOf("cross join lateral jsonb_to_record(order_records.raw)", boundedRows);
assert.ok(boundedRows >= 0, "summary reads must first select a bounded set of order rows");
assert.ok(boundedLimit > boundedRows && summaryProjection > boundedLimit, "the row limit must run before the JSON summary projection");
assert.match(listOrders, /\$\{summary \? "" : whereSql\}/, "non-summary reads must retain their normal where clause");
assert.match(listOrders, /\$\{summary \? "" : `limit/, "non-summary reads must retain their normal limit");

const apiStart = server.indexOf('url.pathname === "/api/orders"');
const apiEnd = server.indexOf('url.pathname === "/api/orders/references"', apiStart);
assert.ok(apiStart >= 0 && apiEnd > apiStart, "orders API route must remain available");
const ordersApi = server.slice(apiStart, apiEnd);
assert.match(ordersApi, /dataplus:orders:v14:/, "orders cache version must invalidate older oversized summaries");
assert.match(ordersApi, /summary \? Promise\.resolve\(\[\]\) : postgres\.readStateField\("orderDrafts"\)/, "summary reads must skip quote drafts");
assert.match(ordersApi, /summary \? Promise\.resolve\(\[\]\) : postgres\.readStateField\("returns"\)/, "summary reads must skip returns");

console.log("Order list performance checks passed.");
