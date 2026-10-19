const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const database = fs.readFileSync(path.join(root, "db.js"), "utf8");
const purchasing = fs.readFileSync(path.join(root, "web", "src", "components", "purchasing-route.tsx"), "utf8");

const routeStart = server.indexOf('url.pathname === "/api/purchasing/work"');
const routeEnd = server.indexOf('url.pathname === "/api/purchasing/supplier-returns"', routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, "purchasing work route must exist");
const route = server.slice(routeStart, routeEnd);

assert.match(route, /excludeStatuses: historyStatuses/, "the initial purchasing request must exclude historical POs");
assert.match(route, /statuses: historyStatusesByScope\[scope\]/, "history tabs must request only their own PO statuses");
assert.match(route, /countPurchaseOrdersByStatus/, "the light initial payload must retain accurate tab counts");
assert.match(route, /countPurchaseOrderReturnsNeedingAttention/, "supplier-return attention must not require loading every historical PO");
assert.doesNotMatch(route, /summarizeSupplierReturns\(db\.purchaseOrders/, "the active workspace must not derive return counts from a full PO history payload");

const poRouteStart = server.indexOf('url.pathname === "/api/purchase-orders/reference-data"');
const poRouteEnd = server.indexOf('parts[1] === "inventory"', poRouteStart);
assert.ok(poRouteStart >= 0 && poRouteEnd > poRouteStart, "purchase-order detail and mutation routes must exist");
const poRoutes = server.slice(poRouteStart, poRouteEnd);
assert.match(poRoutes, /postgres\.readOrdersByIds\(linkedOrderIds\)/, "PO detail must batch linked-order reads");
assert.doesNotMatch(poRoutes, /stateDb = await withOperationalSummary/, "PO mutations must not rebuild global operational state");
assert.doesNotMatch(poRoutes, /state: publicState\(stateDb/, "PO mutations must not serialize global state");

const listStart = database.indexOf("async function listPurchaseOrders(");
const listEnd = database.indexOf("async function readPurchaseOrdersByIds(", listStart);
assert.ok(listStart >= 0 && listEnd > listStart, "purchase-order database list must exist");
const list = database.slice(listStart, listEnd);
assert.match(list, /options\.statuses/, "PO lists must support an included status set");
assert.match(list, /options\.excludeStatuses/, "PO lists must support an excluded status set");
assert.match(list, /offset \$\$\{offsetParameter\}/, "PO lists must retain bounded paging support");

assert.match(purchasing, /loadHistoryScope/, "the React purchasing workspace must lazy-load history tabs");
assert.match(purchasing, /writeWorkspaceCache\("purchasing:work", activeResult\)/, "the memory cache must store only the active PO workspace");
assert.match(purchasing, /api\/purchase-orders\/reference-data/, "purchasing must use compact PO reference data instead of loading global state");
assert.doesNotMatch(purchasing, /api<LiteState>\("\/api\/state\?lite=1"\)/, "purchasing must not load global lite state for PO references");
assert.match(purchasing, /historyLoadingScope === "canceled"/, "large canceled history loads must show progress");
assert.match(purchasing, /purchasingTabs = new Set\([^\n]+"rejected"/, "the rejected PO tab must remain reachable");

console.log("Purchasing workspace performance checks passed.");
