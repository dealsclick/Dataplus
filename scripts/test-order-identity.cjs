const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");
const start = serverSource.indexOf("function marketplaceOrderOperationalScore(");
const end = serverSource.indexOf("function rememberMarketplaceOrder(", start);
const helpers = vm.runInNewContext(`(() => { ${serverSource.slice(start, end)} return { marketplaceOrderOperationalScore, preferredMarketplaceOrder }; })()`);

test("marketplace reconciliation prefers the record containing local operations", () => {
  const original = { id: "original", createdAt: "2026-09-01T00:00:00Z", shipments: [], fulfillmentRoutes: [] };
  const operated = { id: "operated", createdAt: "2026-09-02T00:00:00Z", shipments: [{ id: "shipment" }], fulfillmentRoutes: [{ id: "route" }] };
  assert.equal(helpers.preferredMarketplaceOrder([original, operated]).id, "operated");
});

test("marketplace reconciliation uses the oldest record when operations are equal", () => {
  const oldest = { id: "oldest", createdAt: "2026-09-01T00:00:00Z" };
  const newest = { id: "newest", createdAt: "2026-09-02T00:00:00Z" };
  assert.equal(helpers.preferredMarketplaceOrder([newest, oldest]).id, "oldest");
});

test("order links prefer immutable record IDs over display numbers", () => {
  assert.match(appSource, /String\(order\.id \|\| order\.orderId \|\| order\.internalOrderNumber/);
});
