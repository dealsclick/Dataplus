const assert = require("node:assert/strict");
const test = require("node:test");

const {
  allocateRequestedItems,
  applyLaunchJob,
  datedLiveMerchantSku,
  itemMetrics,
  launchCounts,
  launchReadiness,
  liveRoomSessionMatch,
  matchSessionItemToOrderLine,
  reconcileLiveSessions,
  sessionTotals,
  sourceAvailabilityItems,
} = require("../lib/live-sessions");

test("TikTok active rooms match an explicitly linked DataPlus session", () => {
  const sessions = [
    { id: "session-1", sessionNumber: "LS-101", status: "ready", channel: "tiktok_live", channelAccountId: "shop-1", tiktokCreatorId: "creator-1", tiktokStudio: { liveId: "room-101" } },
    { id: "session-2", sessionNumber: "LS-102", status: "ready", channel: "tiktok_live", channelAccountId: "shop-1", tiktokCreatorId: "creator-1" },
  ];
  const match = liveRoomSessionMatch(sessions, { accountId: "shop-1", creatorId: "creator-1" }, { liveId: "room-101", status: "LIVE" });
  assert.equal(match.session.id, "session-1");
  assert.equal(match.matchMode, "tracked_room");
});

test("TikTok active-room detection refuses to guess between multiple sessions", () => {
  const sessions = [
    { id: "session-1", sessionNumber: "LS-101", status: "ready", channel: "tiktok_live", channelAccountId: "shop-1", tiktokCreatorId: "creator-1" },
    { id: "session-2", sessionNumber: "LS-102", status: "ready", channel: "tiktok_live", channelAccountId: "shop-1", tiktokCreatorId: "creator-1" },
  ];
  const match = liveRoomSessionMatch(sessions, { accountId: "shop-1", creatorId: "creator-1" }, { liveId: "room-202", status: "LIVE" });
  assert.equal(match.session, null);
  assert.equal(match.matchMode, "ambiguous");
  assert.deepEqual(match.candidateSessionNumbers, ["LS-101", "LS-102"]);
});

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

test("eBay event ID selects the correct session and persists the order allocation", () => {
  const sessions = [{
    id: "session-older",
    sessionNumber: "LS-201",
    status: "live",
    channel: "ebay_live",
    channelAccountId: "ebay-primary",
    createdAt: "2026-11-10T12:00:00.000Z",
    items: [{ id: "older-item", sourceType: "purchase_order", upc: "0045242167234", receivedQty: 4, reservedQty: 4 }],
  }, {
    id: "session-event",
    sessionNumber: "LS-202",
    status: "live",
    channel: "ebay_live",
    channelAccountId: "ebay-primary",
    channelEventId: "event-202",
    createdAt: "2026-11-10T13:00:00.000Z",
    items: [{ id: "event-item", sourceType: "purchase_order", sourceId: "po-202", upc: "0045242167234", receivedQty: 2, incomingQty: 1, reservedQty: 3 }],
  }];
  const order = {
    id: "order-event",
    orderNumber: "90001",
    isEbayLive: true,
    channelAccountId: "ebay-primary",
    ebayLive: { eventIds: ["event-202"] },
    items: [{ upc: "0045242167234", qty: 3, ebayLiveEventId: "event-202" }],
  };

  const result = reconcileLiveSessions(sessions, [order]);
  assert.equal(result[0].soldUnits, 0);
  assert.equal(result[1].soldUnits, 3);
  assert.deepEqual(order.liveSessionIds, ["session-event"]);
  assert.equal(order.liveSessionId, "session-event");
  assert.equal(order.items[0].liveSessionId, "session-event");
  assert.equal(order.items[0].liveSessionItemId, "event-item");
  assert.equal(order.items[0].liveSessionMatchMode, "upc");
  assert.equal(order.items[0].liveSessionAllocations[0].receivedInventoryQty, 2);
  assert.equal(order.items[0].liveSessionAllocations[0].receivedInventory, true);
});

test("scheduled sessions do not claim earlier orders without an exact event ID", () => {
  const order = {
    id: "order-before",
    isEbayLive: true,
    channelAccountId: "ebay-primary",
    createdAt: "2026-11-10T12:00:00.000Z",
    items: [{ upc: "0045242167234", qty: 1 }],
  };
  const result = reconcileLiveSessions([{
    id: "scheduled-session",
    status: "ready",
    channel: "ebay_live",
    channelAccountId: "ebay-primary",
    scheduledStartAt: "2026-11-10T13:00:00.000Z",
    items: [{ sourceType: "purchase_order", upc: "0045242167234", receivedQty: 1, reservedQty: 1 }],
  }], [order]);

  assert.equal(result[0].soldUnits, 0);
  assert.deepEqual(order.liveSessionIds, []);
  assert.deepEqual(order.items[0].liveSessionAllocations, []);
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
      salePrice: 24.99,
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
  assert.equal(review.groups[0].salePrice, 24.99);
});

test("eBay Live appends a stable launch date to the manufacturer SKU", () => {
  const review = launchReadiness({
    id: "session-ebay",
    status: "ready",
    channel: "ebay_live",
    channelAccountId: "ebay-primary",
    scheduleTimeZone: "America/New_York",
    items: [{ id: "item-1", productId: "product-1", manufacturerSku: "48-89-2801", reservedQty: 2 }],
  }, [{ id: "product-1", sku: "BUS210787TRV", status: "active" }], { reviewedAt: "2026-11-18T15:00:00.000Z" });

  assert.equal(review.session.items[0].launch.merchantSkuBase, "48-89-2801");
  assert.equal(review.session.items[0].launch.merchantSku, "48-89-2801-LV-11-18-26");
  assert.equal(review.session.launch.merchantSkuDate, "11-18-26");
  assert.equal(review.groups[0].merchantSku, "48-89-2801-LV-11-18-26");
  assert.equal(datedLiveMerchantSku("A".repeat(60), "11-18-26").length, 50);
});

test("launch counters are derived from the current SKU statuses", () => {
  assert.deepEqual(launchCounts([
    { launch: { status: "ready" } },
    { launch: { status: "queued" } },
    { launch: { status: "publishing" } },
    { launch: { status: "scheduled" } },
    { launch: { status: "live" } },
    { launch: { status: "failed" } },
    { launch: { status: "blocked" } },
  ]), { readyItems: 1, blockedItems: 1, queuedItems: 2, submittedItems: 1, liveItems: 1, failedItems: 1 });
});

test("eBay Live falls back to the DataPlus SKU when the manufacturer SKU is missing", () => {
  const review = launchReadiness({
    id: "session-1",
    status: "ready",
    channel: "ebay_live",
    channelAccountId: "ebay-primary",
    items: [{ id: "item-1", productId: "product-1", sku: "DPS10221", supplierSku: "210787", reservedQty: 2 }],
  }, [{ id: "product-1", sku: "DPS10221", status: "active" }]);

  assert.equal(review.session.items[0].launch.status, "ready");
  assert.equal(review.session.items[0].launch.merchantSkuBase, "DPS10221");
  assert.equal(review.session.items[0].launch.merchantSkuSource, "dataplus_sku");
  assert.match(review.session.items[0].launch.merchantSku, /^DPS10221-LV-/);
  assert.equal(review.groups.length, 1);
});

test("TikTok Live uses a generated DataPlus SKU for audit-discovered inventory without an MPN", () => {
  const review = launchReadiness({
    id: "session-1",
    status: "ready",
    channel: "tiktok_live",
    channelAccountId: "tiktok-primary",
    items: [{ id: "item-1", productId: "product-1", sku: "DPS10221", reservedQty: 2 }],
  }, [{ id: "product-1", sku: "DPS10221", status: "active" }]);

  assert.equal(review.session.items[0].launch.status, "ready");
  assert.equal(review.session.items[0].launch.merchantSku, "DPS10221");
  assert.equal(review.session.items[0].launch.merchantSkuSource, "dataplus_sku");
  assert.deepEqual(review.session.items[0].launch.sessionBlockers, []);
  assert.deepEqual(review.session.items[0].launch.productBlockers, []);
  assert.equal(review.groups.length, 1);
});

test("TikTok Live gives unidentified audit products stable editable launch titles and photos", () => {
  const review = launchReadiness({
    id: "session-anonymous",
    status: "ready",
    channel: "tiktok_live",
    channelAccountId: "tiktok-primary",
    items: [
      { id: "item-1", productId: "product-1", sku: "DPS10299", title: "Unidentified product 8055443167126", launchImage: "data:image/png;base64,AAAA", reservedQty: 1 },
      { id: "item-2", productId: "product-2", sku: "DPS10301", title: "Unidentified product 10078555825918", launchTitle: "Warehouse live special", reservedQty: 1 }
    ]
  }, [
    { id: "product-1", sku: "DPS10299", title: "Unidentified product 8055443167126", status: "active" },
    { id: "product-2", sku: "DPS10301", title: "Unidentified product 10078555825918", status: "active" }
  ]);

  assert.equal(review.session.items[0].launch.title, "Random live item #1");
  assert.equal(review.session.items[1].launch.title, "Warehouse live special");
  assert.equal(review.groups[0].title, "Random live item #1");
  assert.equal(review.groups[0].imageDataUrl, "data:image/png;base64,AAAA");
});

test("session readiness blockers stay separate from product corrections", () => {
  const review = launchReadiness({
    id: "session-draft",
    status: "draft",
    channel: "tiktok_live",
    channelAccountId: "tiktok-primary",
    items: [
      { id: "valid-item", productId: "valid-product", sku: "BUS119976TRV", manufacturerSku: "820RL-L", reservedQty: 6 },
      { id: "missing-mpn", productId: "draft-product", sku: "TEMP10299", reservedQty: 1 },
    ],
  }, [
    { id: "valid-product", sku: "BUS119976TRV", status: "active" },
    { id: "draft-product", sku: "TEMP10299", status: "active" },
  ]);

  assert.deepEqual(review.summary.blockers, ["Mark the session ready before publishing."]);
  assert.deepEqual(review.session.items[0].launch.productBlockers, []);
  assert.deepEqual(review.session.items[1].launch.productBlockers, ["A manufacturer SKU or generated DataPlus DPS SKU is required as the channel merchant SKU."]);
  assert.ok(review.session.items.every((item) => item.launch.sessionBlockers.includes("Mark the session ready before publishing.")));
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
  ], { reviewedAt: "2026-11-18T15:00:00.000Z" }).session;
  reviewed.items = reviewed.items.map((item) => ({ ...item, launch: { ...item.launch, status: "queued", jobId: "job-1" } }));
  const applied = applyLaunchJob(reviewed, {
    id: "job-1",
    jobNumber: 42,
    status: "warning",
    phase: "publish_offers",
    processedRows: 2,
    totalRows: 2,
    progressPercent: 100,
    message: "One item needs review.",
    liveSessionLaunchResults: [
      { merchantSku: "48-89-2801-LV-11-18-26", status: "live", listingId: "listing-1", listingUrl: "https://example.test/listing-1" },
      { merchantSku: "48-32-4013-LV-11-18-26", status: "failed", error: "Category mapping is missing." },
    ],
  });

  assert.equal(applied.items[0].launch.status, "live");
  assert.equal(applied.items[0].launch.listingId, "listing-1");
  assert.equal(applied.items[1].launch.status, "failed");
  assert.match(applied.items[1].launch.error, /Category mapping/);
  assert.equal(applied.launch.liveItems, 1);
  assert.equal(applied.launch.failedItems, 1);
  assert.equal(applied.launch.jobPhase, "publish_offers");
  assert.equal(applied.launch.processedItems, 2);
  assert.equal(applied.launch.totalItems, 2);
  assert.equal(applied.launch.progressPercent, 100);
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

test("a future eBay offer remains scheduled instead of being reported live", () => {
  const reviewed = launchReadiness({
    id: "scheduled-session",
    status: "ready",
    channel: "ebay_live",
    channelAccountId: "ebay-primary",
    items: [{ id: "scheduled-item", productId: "product-1", manufacturerSku: "48-89-2801", reservedQty: 1 }],
  }, [{ id: "product-1", sku: "BUS210787TRV", status: "active" }], { reviewedAt: "2026-11-18T15:00:00.000Z" }).session;
  reviewed.items[0].launch = { ...reviewed.items[0].launch, status: "queued", jobId: "job-scheduled" };
  const applied = applyLaunchJob(reviewed, {
    id: "job-scheduled",
    status: "success",
    liveSessionLaunchResults: [{ merchantSku: "48-89-2801-LV-11-18-26", status: "scheduled", listingId: "listing-future" }],
  });

  assert.equal(applied.items[0].launch.status, "scheduled");
  assert.equal(applied.launch.submittedItems, 1);
  assert.equal(applied.launch.liveItems, 0);
});
