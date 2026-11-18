const assert = require("node:assert/strict");
const test = require("node:test");

const {
  allocateRequestedItems,
  applyLaunchJob,
  itemMetrics,
  launchReadiness,
  matchSessionItemToOrderLine,
  reconcileLiveSessions,
  sessionTotals,
  sourceAvailabilityItems,
} = require("../lib/live-sessions");

test("active sessions cannot reserve the same physical source units twice", () => {
  const first = sessionTotals({
    id: "session-1",
    status: "ready",
    items: [{ sourceKey: "purchase_order:po-1:line-1", sourceAvailableQty: 10, reservedQty: 6 }],
  });
  const [second] = allocateRequestedItems([{
    sourceKey: "purchase_order:po-1:line-1",
    sourceAvailableQty: 10,
    requestedQty: 6,
  }], [first]);

  assert.equal(second.reservedQty, 4);
  assert.equal(second.shortageQty, 2);
  assert.equal(second.remainingQty, 4);
});

test("sold PO units stay consumed after a session completes while unused units return", () => {
  const completed = sessionTotals({
    id: "session-1",
    status: "completed",
    items: [{
      sourceKey: "purchase_order:po-1:line-1",
      sourceAvailableQty: 10,
      reservedQty: 10,
      soldQty: 4,
      releasedQty: 6,
    }],
  });
  const [next] = allocateRequestedItems([{
    sourceKey: "purchase_order:po-1:line-1",
    sourceAvailableQty: 10,
    requestedQty: 10,
  }], [completed]);

  assert.equal(next.reservedQty, 6);
  assert.equal(next.shortageQty, 4);
});

test("source previews expose only PO units not already reserved or sold", () => {
  const sessions = [
    sessionTotals({
      id: "active-session",
      status: "live",
      items: [{ sourceKey: "purchase_order:po-1:line-1", sourceAvailableQty: 12, reservedQty: 5, soldQty: 2 }],
    }),
    sessionTotals({
      id: "completed-session",
      status: "completed",
      items: [{ sourceKey: "purchase_order:po-1:line-1", sourceAvailableQty: 12, reservedQty: 3, soldQty: 2, releasedQty: 1 }],
    }),
  ];
  const [preview] = sourceAvailabilityItems([{
    sourceKey: "purchase_order:po-1:line-1",
    sourceAvailableQty: 12,
  }], sessions);

  assert.equal(preview.sourceCommittedQty, 7);
  assert.equal(preview.allocatableQty, 5);
  assert.equal(preview.requestedQty, 5);
  assert.equal(preview.reservedQty, 0);
});

test("live order matching uses UPC, then manufacturer part number, then supplier SKU", () => {
  const item = {
    upc: "0045242167234",
    manufacturerSku: "48-89-2801",
    supplierSku: "BUS210787TRV",
  };
  assert.equal(matchSessionItemToOrderLine(item, {
    upc: "0045242167234",
    manufacturerSku: "48-89-2801",
    supplierSku: "BUS210787TRV",
  }).mode, "upc");
  assert.equal(matchSessionItemToOrderLine(item, {
    manufacturerSku: "48-89-2801",
    supplierSku: "BUS210787TRV",
  }).mode, "manufacturer-part-number");
  assert.equal(matchSessionItemToOrderLine(item, { supplierSku: "BUS210787TRV" }).mode, "supplier-sku");
});

test("the recorded import match mode preserves an original manufacturer SKU", () => {
  const match = matchSessionItemToOrderLine({ manufacturerSku: "48-32-4013" }, {
    originalSku: "48-32-4013",
    skuMappingMode: "manufacturer-part-number",
    sku: "BUS143823TRV",
  });
  assert.equal(match.mode, "manufacturer-part-number");
});

test("repeat reconciliation is deterministic and does not count a shipment twice", () => {
  const sessions = [{
    id: "session-1",
    status: "live",
    channel: "ebay_live",
    createdAt: "2026-11-10T12:00:00.000Z",
    items: [{
      id: "item-1",
      sourceKey: "purchase_order:po-1:line-1",
      upc: "0045242167234",
      manufacturerSku: "48-89-2801",
      reservedQty: 8,
      sourceAvailableQty: 8,
    }],
  }];
  const orders = [{
    id: "order-1",
    orderNumber: "89954",
    isEbayLive: true,
    status: "shipped",
    items: [{ upc: "0045242167234", qty: 3 }],
  }];

  const first = reconcileLiveSessions(sessions, orders);
  const second = reconcileLiveSessions(first, orders);
  assert.equal(first[0].soldUnits, 3);
  assert.equal(first[0].shippedUnits, 3);
  assert.equal(first[0].remainingUnits, 5);
  assert.equal(second[0].soldUnits, 3);
  assert.equal(second[0].shippedUnits, 3);
  assert.equal(second[0].remainingUnits, 5);
});

test("a completed session does not absorb orders placed after it ended", () => {
  const result = reconcileLiveSessions([{
    id: "session-1",
    status: "completed",
    channel: "ebay_live",
    startedAt: "2026-11-10T12:00:00.000Z",
    completedAt: "2026-11-10T13:00:00.000Z",
    items: [{ upc: "0045242167234", reservedQty: 5, releasedQty: 5, sourceAvailableQty: 5 }],
  }], [{
    id: "order-after-session",
    isEbayLive: true,
    createdAt: "2026-11-10T14:00:00.000Z",
    items: [{ upc: "0045242167234", qty: 1 }],
  }]);

  assert.equal(result[0].soldUnits, 0);
  assert.equal(result[0].remainingUnits, 0);
});

test("released units leave the active session without changing source inventory", () => {
  const item = itemMetrics({ reservedQty: 10, soldQty: 3, shippedQty: 2, releasedQty: 4 });
  assert.equal(item.remainingQty, 3);
  assert.equal(item.sourceAvailableQty, 0);
});

test("live launch uses manufacturer SKU and remaining reserved quantity", () => {
  const review = launchReadiness({
    id: "session-1",
    status: "ready",
    channel: "tiktok_live",
    channelAccountId: "shop-1",
    channelAccountName: "Island Supply",
    items: [{
      id: "item-1",
      productId: "product-1",
      sku: "BUS210787TRV",
      supplierSku: "210787",
      manufacturerSku: "48-89-2801",
      reservedQty: 8,
      soldQty: 3,
      releasedQty: 1,
    }],
  }, [{ id: "product-1", sku: "BUS210787TRV", status: "active" }]);

  assert.equal(review.session.items[0].launch.status, "ready");
  assert.equal(review.session.items[0].launch.merchantSku, "48-89-2801");
  assert.equal(review.session.items[0].launch.quantity, 4);
  assert.equal(review.groups[0].merchantSku, "48-89-2801");
  assert.equal(review.groups[0].quantity, 4);
});

test("supplier SKU never substitutes for a missing manufacturer SKU during live launch", () => {
  const review = launchReadiness({
    id: "session-1",
    status: "ready",
    channel: "ebay_live",
    channelAccountId: "ebay-primary",
    items: [{ id: "item-1", productId: "product-1", sku: "BUS210787TRV", supplierSku: "210787", reservedQty: 2 }],
  }, [{ id: "product-1", sku: "BUS210787TRV", status: "active" }]);

  assert.equal(review.session.items[0].launch.status, "blocked");
  assert.equal(review.session.items[0].launch.merchantSku, "");
  assert.match(review.session.items[0].launch.blockers.join(" "), /Manufacturer SKU is required/);
  assert.equal(review.groups.length, 0);
});

test("channel job results persist listing identity and failed rows remain retryable", () => {
  const reviewed = launchReadiness({
    id: "session-1",
    status: "ready",
    channel: "ebay_live",
    channelAccountId: "ebay-primary",
    items: [
      { id: "item-live", productId: "product-1", manufacturerSku: "48-89-2801", reservedQty: 2 },
      { id: "item-failed", productId: "product-2", manufacturerSku: "48-32-4013", reservedQty: 1 },
    ],
  }, [
    { id: "product-1", sku: "BUS210787TRV", status: "active" },
    { id: "product-2", sku: "BUS143823TRV", status: "active" },
  ]).session;
  reviewed.items = reviewed.items.map((item) => ({ ...item, launch: { ...item.launch, status: "queued", jobId: "job-1" } }));
  const applied = applyLaunchJob(reviewed, {
    id: "job-1",
    jobNumber: 42,
    status: "warning",
    message: "One item needs review.",
    liveSessionLaunchResults: [
      { merchantSku: "48-89-2801", status: "live", listingId: "listing-1", listingUrl: "https://example.test/listing-1" },
      { merchantSku: "48-32-4013", status: "failed", error: "Category mapping is missing." },
    ],
  });

  assert.equal(applied.items[0].launch.status, "live");
  assert.equal(applied.items[0].launch.listingId, "listing-1");
  assert.equal(applied.items[1].launch.status, "failed");
  assert.match(applied.items[1].launch.error, /Category mapping/);
  assert.equal(applied.launch.liveItems, 1);
  assert.equal(applied.launch.failedItems, 1);
});

test("readiness review does not queue an already submitted merchant SKU again", () => {
  const review = launchReadiness({
    id: "session-1",
    status: "ready",
    channel: "tiktok_live",
    channelAccountId: "shop-1",
    items: [{
      id: "item-1",
      productId: "product-1",
      manufacturerSku: "48-89-2801",
      reservedQty: 2,
      launch: { status: "submitted", listingId: "listing-1" },
    }],
  }, [{ id: "product-1", sku: "BUS210787TRV", status: "active" }]);

  assert.equal(review.session.items[0].launch.status, "submitted");
  assert.equal(review.session.items[0].launch.listingId, "listing-1");
  assert.equal(review.groups.length, 0);
  assert.equal(review.summary.status, "complete");
});
