const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const dbSource = fs.readFileSync(path.join(root, "db.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");
const { buildOrderIdentity, channelNumberFor } = require("../lib/order-identity");
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
const identityStart = serverSource.indexOf("function marketplaceOrderIdentity(");
const identityEnd = serverSource.indexOf("function marketplaceOrderOperationalScore(", identityStart);
const identityHelpers = vm.runInNewContext(`(() => { ${serverSource.slice(identityStart, identityEnd)} return { findExistingMarketplaceOrder }; })()`, { buildOrderIdentity });

test("marketplace order identity is scoped to channel and channel order ID", () => {
  const db = {
    orders: [
      { id: "ebay-order", source: "eBay", marketplaceOrderNumber: "17-12345-67890" },
      { id: "walmart-order", source: "Walmart", marketplaceOrderNumber: "17-12345-67890" }
    ]
  };
  assert.equal(identityHelpers.findExistingMarketplaceOrder(db, { source: " EBAY ", marketplaceOrderId: "17-12345-67890" }).id, "ebay-order");
  assert.equal(identityHelpers.findExistingMarketplaceOrder(db, { source: "Walmart", marketplaceOrderId: "17-12345-67890" }).id, "walmart-order");
  assert.equal(identityHelpers.findExistingMarketplaceOrder(db, { source: "Shopify", marketplaceOrderId: "17-12345-67890" }), null);
});

test("marketplace order identity is scoped to company and has stable channel numbering", () => {
  assert.equal(buildOrderIdentity({ source: "eBay", marketplaceOrderId: "123" }).identityKey, "100+ebay+123");
  assert.equal(channelNumberFor("eBay"), 1);
  assert.equal(buildOrderIdentity({ source: "eBay / Unclassified sales channel", marketplaceOrderId: "123" }).identityKey, "100+ebay+123");
  const db = {
    orders: [
      { id: "linq", companyNumber: 100, workspaceCompanyId: "linq-usa", source: "eBay", marketplaceOrderId: "123" },
      { id: "other", companyNumber: 205, workspaceCompanyId: "other-company", source: "eBay", marketplaceOrderId: "123" }
    ]
  };
  assert.equal(identityHelpers.findExistingMarketplaceOrder(db, { companyNumber: 100, workspaceCompanyId: "linq-usa", source: "eBay", marketplaceOrderId: "123" }).id, "linq");
  assert.equal(identityHelpers.findExistingMarketplaceOrder(db, { companyNumber: 205, workspaceCompanyId: "other-company", source: "eBay", marketplaceOrderId: "123" }).id, "other");
  assert.equal(identityHelpers.findExistingMarketplaceOrder(db, { companyNumber: 206, workspaceCompanyId: "third-company", source: "eBay", marketplaceOrderId: "123" }), null);
});

test("all compatibility sequence writes preserve the highest order counter", () => {
  const monotonicOrderMerge = /case when state_documents\.data->>'order' ~ '\^\[0-9\]\+\$' then \(state_documents\.data->>'order'\)::bigint else 999 end/g;
  assert.ok((dbSource.match(monotonicOrderMerge) || []).length >= 3);
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

test("marketplace reconciliation prefers the lowest internal number before timestamps", () => {
  const first = { id: "first", internalOrderNumber: "38476", createdAt: "2026-09-02T00:00:00Z" };
  const duplicate = { id: "duplicate", internalOrderNumber: "45000", createdAt: "2026-09-01T00:00:00Z" };
  assert.equal(helpers.preferredMarketplaceOrder([duplicate, first]).id, "first");
});

test("marketplace reconciliation never promotes a marked duplicate over a live record", () => {
  const live = { id: "live", internalOrderNumber: "500", status: "paid" };
  const duplicate = { id: "duplicate", internalOrderNumber: "400", status: "void", duplicateOrderRecord: true, timeline: [{ id: "duplicate-note" }] };
  assert.equal(helpers.preferredMarketplaceOrder([duplicate, live]).id, "live");
});

test("PostgreSQL persists company-channel identities and canonical claims", () => {
  assert.match(dbSource, /create table if not exists order_channel_identities/);
  assert.match(dbSource, /channel_order_identity text/);
  assert.match(dbSource, /CHANNEL_ORDER_IDENTITY_CONFLICT/);
  assert.match(dbSource, /records\.tenant_id=\$1 and records\.company_id=\$2/);
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
