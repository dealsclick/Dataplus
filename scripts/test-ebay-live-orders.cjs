const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ebayLiveLineContext } = require("../lib/ebay-live-order");

const live = ebayLiveLineContext({
  purchaseSource: "EBAY_LIVE",
  soldFormat: "AUCTION",
  ebayLiveContext: { eventId: "event-123" },
  combineShipping: {
    shippingWindow: {
      windowId: "window-456",
      status: "CLOSED",
      shippingWindowEndDate: "2026-10-21T04:00:00.000Z",
    },
  },
});

assert.deepEqual(live, {
  isLive: true,
  purchaseSource: "EBAY_LIVE",
  soldFormat: "AUCTION",
  eventId: "event-123",
  shippingWindow: {
    windowId: "window-456",
    status: "CLOSED",
    endDate: "2026-10-21T04:00:00.000Z",
  },
});
assert.equal(ebayLiveLineContext({ purchaseSource: "EBAY" }).isLive, false);
assert.equal(ebayLiveLineContext({ ebayLiveContext: { eventId: "event-only" } }).isLive, true);

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const dbSource = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
const ordersSource = fs.readFileSync(path.join(__dirname, "..", "web", "src", "App.tsx"), "utf8");
const orderDetailSource = fs.readFileSync(path.join(__dirname, "..", "web", "src", "components", "order-detail-route.tsx"), "utf8");
const liveMarkSource = fs.readFileSync(path.join(__dirname, "..", "web", "src", "components", "ebay-live-mark.tsx"), "utf8");
assert.match(serverSource, /salesOrigin: isEbayLive \? "ebay_live" : "ebay"/);
assert.match(serverSource, /channelSkuMissing: !channelSku/);
assert.match(serverSource, /ebayCombineShippingWindowId: live\.shippingWindow\.windowId/);
assert.match(serverSource, /invalidateFulfillmentConsoleSnapshot\(importableOrders\.map\(\(order\) => order\.id\)\)/);
assert.match(serverSource, /if \(!payload\.historicalBackfill\) await drainFulfillmentConsoleProjectionPatches\(\)/);
assert.match(dbSource, /as is_ebay_live/);
assert.match(dbSource, /as ebay_live/);
assert.match(ordersSource, /orderChannelFilterValue\(row\) === source/);
assert.match(ordersSource, /isEbayLiveOrder\(row\) && <EbayLiveMark/);
assert.match(orderDetailSource, /Live event ID/);
assert.match(orderDetailSource, /Sales channel: eBay/);
assert.match(liveMarkSource, /EBAY_LIVE_FILTER_VALUE = "ebay_live"/);

console.log("eBay Live order tests passed.");
