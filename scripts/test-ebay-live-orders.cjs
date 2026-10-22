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
assert.match(serverSource, /salesOrigin: isEbayLive \? "ebay_live" : "ebay"/);
assert.match(serverSource, /channelSkuMissing: !channelSku/);
assert.match(serverSource, /ebayCombineShippingWindowId: live\.shippingWindow\.windowId/);
assert.match(dbSource, /as is_ebay_live/);
assert.match(dbSource, /as ebay_live/);

console.log("eBay Live order tests passed.");
