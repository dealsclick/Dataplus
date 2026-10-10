const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  rateReviewNeedsScheduledRefresh,
  rateReviewNextRefreshAt
} = require("../lib/fulfillment-rate-freshness");

const now = Date.parse("2026-10-10T16:00:00Z");
const minutes = (value) => value * 60_000;

assert.equal(rateReviewNextRefreshAt({ selectedRate: { provider: "veeqo", quotedAt: "2026-10-10T15:00:00Z", expiresAt: "2026-10-10T17:00:00Z" } }, "veeqo"), Date.parse("2026-10-10T16:55:00Z"));
assert.equal(rateReviewNeedsScheduledRefresh({ selectedRate: { provider: "veeqo", expiresAt: "2026-10-10T16:04:00Z" } }, "veeqo", { now }), true);
assert.equal(rateReviewNeedsScheduledRefresh({ selectedRate: { provider: "veeqo", quotedAt: "2026-10-10T15:50:00Z" } }, "veeqo", { now }), false);
assert.equal(rateReviewNeedsScheduledRefresh({ selectedRate: { provider: "veeqo", quotedAt: "2026-10-10T15:44:00Z" } }, "veeqo", { now }), true);
assert.equal(rateReviewNeedsScheduledRefresh({ selectedRate: { provider: "temu", quotedAt: "2026-10-10T15:50:00Z" } }, "temu", { now }), false);
assert.equal(rateReviewNeedsScheduledRefresh({ selectedRate: { provider: "temu", quotedAt: "2026-10-10T15:44:00Z" } }, "temu", { now }), true);
assert.equal(rateReviewNeedsScheduledRefresh({ selectedRate: { provider: "temu", action: "retrieve_existing_label", quotedAt: "2026-10-10T12:00:00Z" } }, "temu", { now }), false);
assert.equal(rateReviewNeedsScheduledRefresh({ selectedRate: { provider: "shopify", quotedAt: "2026-10-10T12:00:00Z" } }, "shopify", { now }), false);
assert.equal(rateReviewNextRefreshAt({ ratedAt: "2026-10-10T15:45:00Z", selectedRate: { provider: "temu" } }, "temu"), now);
assert.equal(rateReviewNextRefreshAt({ ratedAt: "2026-10-10T15:45:00Z", selectedRate: { provider: "temu" } }, "temu", { ttlMs: minutes(20) }), now + minutes(5));

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const dbSource = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
assert.match(serverSource, /const snapshot = await readFulfillmentConsoleSnapshot\(\)/, "automatic rate scheduling must reuse the fulfillment snapshot instead of scanning 5,000 orders");
assert.match(serverSource, /rateReviewNeedsScheduledRefresh\(row\.rateReview, lane\)/, "automatic scheduling must use provider-specific freshness");
assert.match(serverSource, /\.slice\(0, 50\)/, "automatic refresh work must be staggered into small jobs");
assert.match(serverSource, /latestAt > Date\.now\(\) - 60_000/, "another due rate batch may start after a short cooldown");
assert.match(serverSource, /postgres\.readPurchaseOrdersByIds\(purchaseOrderIds\)/, "targeted rate jobs must not hydrate every purchase order");
assert.match(dbSource, /async function readPurchaseOrdersByIds\(ids = \[\]\)/, "targeted purchase-order hydration must be available");

console.log("Fulfillment provider rate freshness tests passed.");
