const test = require("node:test");
const assert = require("node:assert/strict");
const { preserveShipmentCorrections, shipmentReopenPlan } = require("../lib/shipment-corrections");
const fs = require("node:fs");
const vm = require("node:vm");
const { XMLBuilder } = require("fast-xml-parser");
const serverSource = fs.readFileSync(require.resolve("../server.js"), "utf8").replace(/\r\n/g, "\n");
function loadServerFunction(name, context) {
  const start = serverSource.indexOf(`async function ${name}(`);
  const end = serverSource.indexOf("\n}\n", start) + 2;
  return vm.runInNewContext(`(${serverSource.slice(start, end)})`, context);
}

test("repeated SKUs require a line index and reopen only that line", () => {
  const lines = [{ sku: "A", qty: 2 }, { sku: "A", qty: 3 }];
  assert.throws(() => shipmentReopenPlan(lines, { lines: [{ sku: "A", qty: 1 }] }), /ambiguous/);
  assert.deepEqual(shipmentReopenPlan(lines, { lines: [{ sku: "A", lineIndex: 1, qtyFulfilled: 1 }] }), [{ lineIndex: 1, qty: 1 }]);
});

test("reject empty, excessive and nonnumeric package quantities", () => {
  const lines = [{ sku: "A", qty: 2 }];
  for (const entries of [[], [{ sku: "A", qty: 3 }], [{ sku: "A", qty: "bad" }], [{ sku: "A", qty: 2, qtyFulfilled: 0 }]]) {
    assert.throws(() => shipmentReopenPlan(lines, { lines: entries }));
  }
});

test("aggregate duplicate package rows without reopening other quantities", () => {
  assert.deepEqual(shipmentReopenPlan([{ sku: "A", qty: 3 }], { lines: [{ sku: "A", qty: 1 }, { sku: "A", qty: 1 }] }), [{ lineIndex: 0, qty: 2 }]);
});

test("source refresh retains tracking edits and all history", () => {
  const history = Array.from({ length: 60 }, (_, i) => ({ trackingNumber: String(i) }));
  const existing = { trackingNumber: "corrected", shippingCost: 7, trackingHistory: history, shipments: [{ id: "s", trackingUpdatedAt: "today", trackingHistory: history }] };
  const result = preserveShipmentCorrections({ trackingNumber: "old", shippingCost: 5, buyer: "Updated buyer", shipments: [] }, existing);
  assert.equal(result.trackingNumber, "corrected");
  assert.equal(result.shippingCost, 7);
  assert.equal(result.buyer, "Updated buyer");
  assert.equal(result.shipments[0].trackingHistory.length, 60);
  assert.equal(result.trackingHistory.length, 60);
});

test("active unship survives refresh while cancellation remains observable", () => {
  const existing = { shipmentCorrection: { active: true }, status: "ready", shipments: [{ reopenedAt: "today" }], items: [{ sku: "A", qty: 1, fulfilledQty: 0, remainingQty: 1 }] };
  const incoming = { status: "canceled", items: [{ sku: "A", qty: 1, price: 5, fulfilledQty: 1 }] };
  const result = preserveShipmentCorrections(incoming, existing);
  assert.equal(result.status, "ready");
  assert.equal(result.channelStatus, "canceled");
  assert.equal(result.items[0].fulfilledQty, 0);
  assert.equal(result.items[0].price, 5);
  assert.equal(incoming.items[0].fulfilledQty, 1);
});

test("uncorrected orders continue to use incoming channel state", () => {
  const incoming = { status: "shipped", shipments: [{ id: "new" }] };
  assert.equal(preserveShipmentCorrections(incoming, { shipments: [] }), incoming);
});

test("a new source package is imported without replacing corrected tracking", () => {
  const existing = { shipments: [{ id: "one", trackingUpdatedAt: "today", trackingNumber: "new", trackingHistory: [{ trackingNumber: "old" }] }] };
  const result = preserveShipmentCorrections({ shipments: [{ id: "one", trackingNumber: "old" }, { id: "two", trackingNumber: "second" }] }, existing);
  assert.equal(result.shipments.length, 2);
  assert.equal(result.shipments[0].trackingNumber, "new");
  assert.equal(result.shipments[1].trackingNumber, "second");
});

test("Shopify edits update the existing fulfillment and surface userErrors", async () => {
  const calls = [];
  const sync = loadServerFunction("syncShopifyShipment", { shopifyGraphqlRequestAuto: async (query, variables) => {
    calls.push({ query, variables });
    return { fulfillmentTrackingInfoUpdate: { fulfillment: { id: "gid://shopify/Fulfillment/1" }, userErrors: [] } };
  } });
  await sync({ shopifyOrderId: "gid://shopify/Order/1" }, { channelSync: { fulfillmentId: "gid://shopify/Fulfillment/1" }, trackingNumber: "new", carrier: "UPS" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].query, /fulfillmentTrackingInfoUpdate/);
  assert.equal(calls[0].variables.tracking.number, "new");
  const failed = loadServerFunction("syncShopifyShipment", { shopifyGraphqlRequestAuto: async () => ({ fulfillmentTrackingInfoUpdate: { userErrors: [{ message: "Denied" }] } }) });
  await assert.rejects(failed({ shopifyOrderId: "gid://shopify/Order/1" }, { channelSync: { fulfillmentId: "gid://shopify/Fulfillment/1" } }), /Denied/);
});

test("eBay correction retains other package tracking and escapes XML", async () => {
  const writes = [];
  const sync = loadServerFunction("syncEbayShipmentTracking", {
    XMLBuilder, shipmentReopenPlan, orderLineItems: (order) => order.items,
    ebayTradingText: (value) => String(value ?? ""), ebayTradingArray: (value) => Array.isArray(value) ? value : value ? [value] : [],
    ebayTradingRequest: async (_db, name, payload) => {
      if (name === "GetOrders") return { OrderArray: { Order: { TransactionArray: { Transaction: { OrderLineItemID: "line", Item: { ItemID: "item", SKU: "A" }, TransactionID: "tx", ShippingDetails: { ShipmentTrackingDetails: [{ ShipmentTrackingNumber: "old", ShippingCarrierUsed: "UPS" }, { ShipmentTrackingNumber: "other-package", ShippingCarrierUsed: "UPS" }] } } } } } };
      writes.push(payload);
      return { Ack: "Success" };
    }
  });
  await sync({}, { marketplaceOrderId: "source", items: [{ lineId: "line", sku: "A", qty: 2 }] }, { trackingNumber: "new&value", carrierName: "UPS", trackingHistory: [{ trackingNumber: "old" }], lines: [{ sku: "A", lineIndex: 0, qty: 1 }] });
  assert.equal(writes.length, 1);
  assert.match(writes[0], /other-package/);
  assert.match(writes[0], /new&amp;value/);
  assert.doesNotMatch(writes[0], /<Paid>|<Shipped>|>old</);
});

test("unship endpoint preserves a second shipped line, cost and actual operator", async () => {
  const order = { id: "order", status: "shipped", shippingCost: 12, items: [{ sku: "A", qty: 1 }, { sku: "A", qty: 1 }], shipments: [
    { id: "one", status: "shipped", trackingNumber: "first", shippingCost: 5, lines: [{ lineIndex: 0, sku: "A", qty: 1 }] },
    { id: "two", status: "shipped", trackingNumber: "second", shippingCost: 7, lines: [{ lineIndex: 1, sku: "A", qty: 1 }] }
  ] };
  const marker = serverSource.indexOf('parts[5] === "unship"');
  const start = serverSource.lastIndexOf('\n  if (req.method', marker);
  const end = serverSource.indexOf('\n  if (req.method', marker);
  let saved;
  const result = await vm.runInNewContext(`(async () => { ${serverSource.slice(start, end)} })()`, {
    req: { method: "POST" }, res: {}, parts: ["api", "orders", "order", "shipments", "one", "unship"],
    postgres: { isPostgresEnabled: () => true, readOrderByKey: async () => order, saveOrder: async (value) => { saved = value; } },
    parseBody: async () => ({ reason: "Incorrect shipment", user: "spoofed" }), authUser: { name: "Taylor" },
    orderLineItems: (value) => value.items, shipmentReopenPlan, structuredClone, crypto: require("node:crypto"),
    createOrderException: (value, entry) => { value.workflowExceptions = [entry]; },
    recalculateOrderOperationalStatus: (value) => { value.operationalStatus = "on_hold"; },
    appendOrderShippingEvent: () => {}, addOrderTimeline: () => {}, clearOrderApiCache: () => {}, orderSourceChannelName: () => "Temu",
    sendJson: (_res, status, body) => ({ status, body })
  });
  assert.equal(result.status, 200);
  assert.equal(saved.items[0].remainingQty, 1);
  assert.equal(saved.fulfillmentLines[0].lineIndex, 1);
  assert.equal(saved.fulfillmentLines[0].qtyFulfilled, 1);
  assert.equal(saved.shipments[1].status, "shipped");
  assert.equal(saved.shippingCost, 12);
  assert.equal(saved.shipments[0].unshipHistory[0].lines[0].qty, 1);
  assert.equal(saved.shipments[0].reopenedBy, "Taylor");
  assert.equal(saved.shipmentCorrection.active, true);
});
