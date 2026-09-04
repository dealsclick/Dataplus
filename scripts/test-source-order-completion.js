const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSourceOrderCompletion } = require("../lib/source-order-completion");

test("refunded eBay order 4295 moves to done without changing financials", () => {
  const order = { source: "eBay", status: "refunded", financialStatus: "Refunded", operationalStatus: "canceled", external: { orderFulfillmentStatus: "FULFILLED" }, workflowExceptions: [{ type: "channel_canceled_after_shipment", status: "open", severity: "blocking" }] };
  assert.equal(normalizeSourceOrderCompletion(order), true);
  assert.equal(order.operationalStatus, "completed");
  assert.equal(order.status, "refunded");
  assert.equal(order.financialStatus, "Refunded");
  assert.equal(order.workflowExceptions[0].status, "resolved");
  assert.equal(normalizeSourceOrderCompletion(order), false);
});

for (const source of ["Temu", "Shopify", "eBay"]) test(`${source} completed shipment supersedes sourcing exceptions`, () => {
  const order = { source, status: "shipped", workflowExceptions: [{ type: "missing_catalog_product", severity: "blocking", status: "open" }] };
  normalizeSourceOrderCompletion(order);
  assert.equal(order.operationalStatus, "completed");
});

test("partial shipments and reopened shipments are not closed", () => {
  for (const order of [{ status: "partial_fulfilled", items: [{ fulfillmentStatus: "fulfilled" }, { fulfillmentStatus: "unfulfilled" }] }, { status: "shipped", shipmentCorrection: { active: true } }]) assert.equal(normalizeSourceOrderCompletion(order), false);
});

test("real cancellations, supplier commitments and open returns retain attention", () => {
  for (const order of [
    { status: "canceled", external: { orderFulfillmentStatus: "FULFILLED" } },
    { status: "shipped", workflowExceptions: [{ type: "channel_canceled_after_committed_po", severity: "blocking", status: "open" }] },
    { status: "shipped", returns: [{ status: "requested" }] }
  ]) { normalizeSourceOrderCompletion(order); assert.notEqual(order.operationalStatus, "completed"); }
});
