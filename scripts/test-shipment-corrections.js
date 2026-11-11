const test = require("node:test");
const assert = require("node:assert/strict");
const { preserveShipmentCorrections, shipmentLineAssociationPlan, shipmentReopenPlan } = require("../lib/shipment-corrections");
const fs = require("node:fs");
const vm = require("node:vm");
const { XMLBuilder } = require("fast-xml-parser");
const { canonicalCarrierName, normalizeTrackingNumber } = require("../lib/shipping-carriers");
const serverSource = fs.readFileSync(require.resolve("../server.js"), "utf8").replace(/\r\n/g, "\n");
function loadServerFunction(name, context) {
  const start = serverSource.indexOf(`async function ${name}(`);
  const end = serverSource.indexOf("\n}\n", start) + 2;
  return vm.runInNewContext(`(${serverSource.slice(start, end)})`, context);
}
function loadServerSyncFunction(name, context) {
  const start = serverSource.indexOf(`function ${name}(`);
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
  for (const entries of [[], [{ sku: "A", qty: 3 }], [{ sku: "A", qty: "bad" }], [{ sku: "A", qty: 0 }]]) {
    assert.throws(() => shipmentReopenPlan(lines, { lines: entries }));
  }
});

test("legacy zero-quantity placeholders do not block a valid package line", () => {
  const lines = [{ sku: "A", qty: 2 }];
  assert.deepEqual(shipmentReopenPlan(lines, { lines: [
    { sku: "A", lineIndex: 0, qty: 0 },
    { sku: "A", lineIndex: 0, qty: 2 }
  ] }), [{ lineIndex: 0, qty: 2 }]);
});

test("one-line mapped package SKU keeps its explicit order line association", () => {
  const lines = [{ sku: "CHANNEL-SKU", qty: 2 }];
  assert.deepEqual(shipmentReopenPlan(lines, {
    lines: [{ sku: "MAPPED-CATALOG-SKU", lineIndex: 0, qty: 2 }]
  }), [{ lineIndex: 0, qty: 2 }]);
});

test("multi-line mapped package SKU still requires an unambiguous association", () => {
  const lines = [{ sku: "CHANNEL-A", qty: 1 }, { sku: "CHANNEL-B", qty: 1 }];
  assert.throws(() => shipmentReopenPlan(lines, {
    lines: [{ sku: "MAPPED-CATALOG-SKU", lineIndex: 0, qty: 1 }]
  }), /ambiguous/);
});

test("label purchase sends tracking immediately for eBay and Walmart only", async () => {
  const calls = [];
  const sync = loadServerFunction("syncPurchasedMarketplaceShipment", {
    syncDropshipShipmentToChannel: async (...args) => { calls.push(args); return { status: "sent" }; }
  });
  assert.equal((await sync({}, { source: "eBay" }, { trackingNumber: "9400" }, "Luis")).status, "sent");
  assert.equal((await sync({}, { source: "Walmart" }, { trackingNumber: "1Z1" }, "Luis")).status, "sent");
  assert.equal(await sync({}, { source: "Temu" }, { trackingNumber: "9300" }, "Luis"), null);
  assert.equal(await sync({}, { source: "eBay" }, { trackingNumber: "" }, "Luis"), null);
  assert.equal(calls.length, 2);
});

test("combined label purchase sends tracking to every linked marketplace order", async () => {
  const calls = [];
  const saved = [];
  const sync = loadServerFunction("syncPurchasedShipmentGroupMembers", {
    syncPurchasedMarketplaceShipment: async (_db, order, shipment) => {
      calls.push({ order: order.orderNumber, tracking: shipment.trackingNumber });
      return { status: "sent" };
    },
    postgres: { saveOrder: async (order) => saved.push(order.orderNumber) },
    clearOrderApiCache: () => {}
  });
  const results = await sync({}, { linked: [
    { order: { id: "child-1", orderNumber: "88361" }, shipment: { id: "shipment-1", trackingNumber: "9400" } },
    { order: { id: "child-2", orderNumber: "88364" }, shipment: { id: "shipment-2", trackingNumber: "9400" } }
  ] }, "Luis");
  assert.deepEqual(calls, [{ order: "88361", tracking: "9400" }, { order: "88364", tracking: "9400" }]);
  assert.deepEqual(saved, ["88361", "88364"]);
  assert.deepEqual(Array.from(results, (entry) => entry.status), ["sent", "sent"]);
});

test("eBay access token hydrates persisted connector state before a tracking write", async () => {
  let reads = 0;
  const accessToken = loadServerFunction("ebayAccessToken", {
    getEbayConfig: (db) => ({
      accessToken: db.connectorState?.ebayAccessToken || "",
      refreshToken: db.connectorState?.ebayRefreshToken || "",
      accessTokenExpiresAt: db.connectorState?.ebayAccessTokenExpiresAt || ""
    }),
    postgres: { isPostgresEnabled: () => true },
    readConnectorStateStore: async () => {
      reads += 1;
      return { ebayAccessToken: "persisted-access", ebayRefreshToken: "persisted-refresh", ebayAccessTokenExpiresAt: "2099-01-01T00:00:00.000Z" };
    },
    refreshEbayAccessToken: async () => { throw new Error("refresh should not run"); }
  });
  const db = {};
  assert.equal(await accessToken(db), "persisted-access");
  assert.equal(reads, 1);
  assert.equal(db.connectorState.ebayRefreshToken, "persisted-refresh");
});

test("eBay Trading errors retain codes and messages for operator review", () => {
  const message = loadServerSyncFunction("ebayTradingErrorMessage", {
    ebayTradingArray: (value) => Array.isArray(value) ? value : value ? [value] : [],
    ebayTradingText: (value) => String(value ?? "")
  });
  assert.equal(message({ Errors: { ErrorCode: "21917053", LongMessage: "The order line item is invalid." } }), "Error 21917053: The order line item is invalid.");
  assert.equal(message({ Errors: { Error: [{ ErrorCode: "10007", ShortMessage: "Internal error." }] } }), "Error 10007: Internal error.");
});

test("a newly purchased label rejects tracking already active on an unrelated order", () => {
  const conflict = loadServerSyncFunction("purchasedTrackingConflict", {
    normalizeTrackingNumber,
    activeShippingLabelShipments: (order) => (order.shipments || []).filter((shipment) => shipment.voidStatus !== "voided")
  });
  const current = { id: "current", orderNumber: "88328", shipmentGroupId: "group-karen" };
  const candidates = [
    { order: { id: "same-group", orderNumber: "88353", shipmentGroupId: "group-karen", shipments: [{ trackingNumber: "1Z DUPLICATE" }] } },
    { shipmentId: "old-shipment", order: { id: "unrelated", orderNumber: "55582", buyer: "Daniel", shipments: [{ trackingNumber: "1Z DUPLICATE" }] } }
  ];
  assert.deepEqual(
    JSON.parse(JSON.stringify(conflict(current, "1zduplicate", candidates))),
    { orderId: "unrelated", orderNumber: "55582", marketplaceOrderId: "", buyer: "Daniel", shipmentId: "old-shipment", trackingNumber: "1ZDUPLICATE" }
  );
  assert.equal(conflict(current, "1zduplicate", [{ order: { id: "voided", shipments: [{ trackingNumber: "1Z DUPLICATE", voidStatus: "voided" }] } }]), null);
});

test("aggregate duplicate package rows without reopening other quantities", () => {
  assert.deepEqual(shipmentReopenPlan([{ sku: "A", qty: 3 }], { lines: [{ sku: "A", qty: 1 }, { sku: "A", qty: 1 }] }), [{ lineIndex: 0, qty: 2 }]);
});

test("channel tracking associates duplicate lifecycle rows once without weakening reopen quantities", () => {
  const lines = [{ sku: "A", qty: 1 }];
  const shipment = { lines: [{ sku: "A", lineIndex: 0, qty: 1 }, { sku: "A", lineIndex: 0, qty: 1 }] };
  assert.deepEqual(shipmentLineAssociationPlan(lines, shipment), [{ lineIndex: 0 }]);
  assert.throws(() => shipmentReopenPlan(lines, shipment), /exceeds/);
});

test("channel tracking still rejects ambiguous shipment line associations", () => {
  assert.throws(() => shipmentLineAssociationPlan([{ sku: "A", qty: 1 }, { sku: "A", qty: 1 }], { lines: [{ sku: "A", qty: 1 }] }), /ambiguous/);
});

test("received purchase routes are replaced by their active warehouse route for shipping", () => {
  const selectRoutes = loadServerSyncFunction("fulfillmentRoutesForShipment", {});
  const order = { fulfillmentRoutes: [
    { id: "purchase", type: "purchase", status: "received", lineIndex: 0, qty: 1 },
    { id: "warehouse", type: "warehouse", status: "allocated", lineIndex: 0, qty: 1 },
    { id: "open-purchase", type: "purchase", status: "processing", lineIndex: 1, qty: 1 }
  ] };
  assert.deepEqual(Array.from(selectRoutes(order), (route) => route.id), ["warehouse", "open-purchase"]);
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
  const sync = loadServerFunction("syncShopifyShipment", { canonicalCarrierName, normalizeTrackingNumber, shopifyGraphqlRequestAuto: async (query, variables) => {
    calls.push({ query, variables });
    return { fulfillmentTrackingInfoUpdate: { fulfillment: { id: "gid://shopify/Fulfillment/1" }, userErrors: [] } };
  } });
  await sync({ shopifyOrderId: "gid://shopify/Order/1" }, { channelSync: { fulfillmentId: "gid://shopify/Fulfillment/1" }, trackingNumber: "new", carrier: "UPS" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].query, /fulfillmentTrackingInfoUpdate/);
  assert.equal(calls[0].variables.tracking.number, "NEW");
  const failed = loadServerFunction("syncShopifyShipment", { canonicalCarrierName, normalizeTrackingNumber, shopifyGraphqlRequestAuto: async () => ({ fulfillmentTrackingInfoUpdate: { userErrors: [{ message: "Denied" }] } }) });
  await assert.rejects(failed({ shopifyOrderId: "gid://shopify/Order/1" }, { channelSync: { fulfillmentId: "gid://shopify/Fulfillment/1" } }), /Denied/);
});

test("eBay correction retains other package tracking and escapes XML", async () => {
  const writes = [];
  const sync = loadServerFunction("syncEbayShipmentTracking", {
    XMLBuilder, shipmentLineAssociationPlan, canonicalCarrierName, normalizeTrackingNumber, orderLineItems: (order) => order.items,
    ebayShippingFulfillments: async () => [], ebayShipmentTrackingEvidence: () => null,
    verifyEbayShipmentTracking: async () => ({ fulfillmentId: "fulfillment-1", verifiedAt: "2026-11-02T20:00:00.000Z" }),
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
  assert.match(writes[0], />NEWVALUE</);
  assert.doesNotMatch(writes[0], /<Paid>|<Shipped>|>old</);
});

test("eBay Live tracking matches the marketplace line or legacy item when the listing has no seller SKU", async () => {
  const writes = [];
  const sync = loadServerFunction("syncEbayShipmentTracking", {
    XMLBuilder, shipmentLineAssociationPlan, canonicalCarrierName, normalizeTrackingNumber, orderLineItems: (order) => order.items,
    ebayShippingFulfillments: async () => [], ebayShipmentTrackingEvidence: () => null,
    verifyEbayShipmentTracking: async () => ({ fulfillmentId: "fulfillment-live", verifiedAt: "2026-11-02T20:00:00.000Z" }),
    ebayTradingText: (value) => String(value ?? ""), ebayTradingArray: (value) => Array.isArray(value) ? value : value ? [value] : [],
    ebayTradingRequest: async (_db, name, payload) => {
      if (name === "GetOrders") return { OrderArray: { Order: { TransactionArray: { Transaction: { OrderLineItemID: "10088989041018", Item: { ItemID: "117493123780" }, TransactionID: "live-tx" } } } } };
      writes.push(payload);
      return { Ack: "Success" };
    }
  });
  await sync({}, { marketplaceOrderId: "18-15346-37578", items: [{ lineId: "internal-hash", marketplaceLineItemId: "10088989041018", legacyItemId: "117493123780", sku: "117493123780", qty: 1 }] }, { trackingNumber: "879601127269", carrierName: "FedEx", lines: [{ sku: "117493123780", lineIndex: 0, qty: 1 }] });
  assert.equal(writes.length, 1);
  assert.match(writes[0], /<ItemID>117493123780<\/ItemID>/);
  assert.match(writes[0], /<TransactionID>live-tx<\/TransactionID>/);
});

test("eBay tracking is not confirmed when fulfillment readback does not contain it", async () => {
  const sync = loadServerFunction("syncEbayShipmentTracking", {
    XMLBuilder, shipmentLineAssociationPlan, canonicalCarrierName, normalizeTrackingNumber, orderLineItems: (order) => order.items,
    ebayShippingFulfillments: async () => [], ebayShipmentTrackingEvidence: () => null,
    verifyEbayShipmentTracking: async () => { throw new Error("fulfillment readback did not include 1Z999"); },
    ebayTradingText: (value) => String(value ?? ""), ebayTradingArray: (value) => Array.isArray(value) ? value : value ? [value] : [],
    ebayTradingRequest: async (_db, name) => name === "GetOrders"
      ? { OrderArray: { Order: { TransactionArray: { Transaction: { OrderLineItemID: "line", Item: { ItemID: "item", SKU: "A" }, TransactionID: "tx" } } } } }
      : { Ack: "Success" }
  });
  await assert.rejects(
    sync({}, { marketplaceOrderId: "source", items: [{ lineId: "line", sku: "A", qty: 1 }] }, { trackingNumber: "1Z999", carrierName: "UPS", lines: [{ sku: "A", lineIndex: 0, qty: 1 }] }),
    /fulfillment readback did not include/
  );
});

test("eBay tracking sync accepts existing fulfillment readback without another write", async () => {
  let writes = 0;
  const evidence = { fulfillmentId: "existing", trackingNumber: "1Z999", verifiedAt: "2026-11-11T19:00:00.000Z" };
  const sync = loadServerFunction("syncEbayShipmentTracking", {
    ebayShippingFulfillments: async () => [{ shipmentTrackingNumber: "1Z999" }],
    ebayShipmentTrackingEvidence: () => evidence,
    ebayTradingRequest: async () => { writes += 1; throw new Error("must not write"); }
  });
  assert.deepEqual(await sync({}, { marketplaceOrderId: "source" }, { trackingNumber: "1Z999" }), evidence);
  assert.equal(writes, 0);
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
