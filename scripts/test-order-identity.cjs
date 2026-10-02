const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const dbSource = fs.readFileSync(path.join(root, "db.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");
const start = serverSource.indexOf("function marketplaceOrderOperationalScore(");
const end = serverSource.indexOf("function rememberMarketplaceOrder(", start);
const helpers = vm.runInNewContext(`(() => { ${serverSource.slice(start, end)} return { marketplaceOrderOperationalScore, preferredMarketplaceOrder }; })()`);
const reportableStart = dbSource.indexOf("function orderIsReportable(");
const reportableEnd = dbSource.indexOf("function dateOrNull(", reportableStart);
const { orderIsReportable } = vm.runInNewContext(`(() => { ${dbSource.slice(reportableStart, reportableEnd)} return { orderIsReportable }; })()`);
const duplicateStart = serverSource.indexOf("const DUPLICATE_ORDER_VOID_NOTE");
const duplicateEnd = serverSource.indexOf("function reconcileDuplicateTemuOrderGroup(", duplicateStart);
const duplicateHelpers = vm.runInNewContext(`(() => { ${serverSource.slice(duplicateStart, duplicateEnd)} return { markDuplicateOrderVoided }; })()`, {
  crypto: { randomUUID: () => "note-id" },
  orderLineItems: (order) => order.items || [],
  addOrderTimeline: (order, event) => { order.timeline = [...(order.timeline || []), event]; }
});

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

test("void and duplicate orders are never reportable", () => {
  assert.equal(orderIsReportable({ status: "paid" }), true);
  assert.equal(orderIsReportable({ status: "void" }), false);
  assert.equal(orderIsReportable({ status: "paid", duplicateOrderRecord: true }), false);
  assert.equal(orderIsReportable({ status: "paid", excludedFromAnalytics: true }), false);
  const duplicate = duplicateHelpers.markDuplicateOrderVoided(
    { id: "duplicate", status: "shipped", items: [{ sku: "SKU", qty: 1, remainingQty: 1 }] },
    { id: "canonical", orderNumber: "46048" },
    "2026-10-02T12:00:00.000Z",
    "Test"
  );
  assert.equal(duplicate.status, "void");
  assert.equal(duplicate.reportable, false);
  assert.equal(duplicate.excludedFromAnalytics, true);
  assert.equal(duplicate.duplicateOfOrderNumber, "46048");
  assert.equal(duplicate.items[0].remainingQty, 0);
  assert.equal(duplicate.orderNotes[0].text, "Voided due to duplicate.");
});
