const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  findFreshVeeqoRate,
  isStaleVeeqoRateError,
  veeqoRateExpiresAt,
  veeqoRateNeedsRefresh
} = require("../lib/veeqo-rate-freshness");

const now = Date.parse("2026-10-08T20:00:00Z");
assert.equal(veeqoRateNeedsRefresh({}, { now }), true, "legacy quotes without expiration must refresh");
assert.equal(veeqoRateNeedsRefresh({ expiresAt: "2026-10-08T20:00:59Z" }, { now }), true, "quotes inside the safety window must refresh");
assert.equal(veeqoRateNeedsRefresh({ raw: { expires_at: "2026-10-08T20:05:00Z" } }, { now }), false, "fresh quotes remain usable");
assert.equal(veeqoRateExpiresAt({ raw: { cutoff: "2026-10-08T20:05:00Z" } }), "2026-10-08T20:05:00Z");

const selected = { provider: "veeqo", carrier: "FedEx", service: "FedEx Ground Economy", amount: 8.25 };
const replacement = { provider: "veeqo", carrier: "FEDEX", service: "FedEx Ground Economy", amount: 8.41, remoteShipmentId: "prb-new" };
assert.equal(findFreshVeeqoRate([{ provider: "veeqo", carrier: "UPS", service: "Ground" }, replacement], selected), replacement);
assert.equal(findFreshVeeqoRate([{ provider: "veeqo", carrier: "UPS", service: "Ground" }], selected), null);
assert.equal(isStaleVeeqoRateError(new Error("No rate data found for remote_shipment_id 'prb-old'. Rates may have expired.")), true);
assert.equal(isStaleVeeqoRateError(new Error("Insufficient label balance")), false);

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const dbSource = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
assert.match(serverSource, /responseExpiresAt[\s\S]*expires_at: rate\.expires_at \|\| rate\.expiresAt \|\| responseExpiresAt/, "top-level Veeqo expiration must be copied onto every normalized quote");
assert.match(serverSource, /if \(veeqoRateNeedsRefresh\(purchaseRate\)\)[\s\S]*purchaseRate = await refreshSelectedRate/, "label purchase must refresh missing or expiring quotes");
assert.match(serverSource, /if \(!isStaleVeeqoRateError\(error\)\) throw error;[\s\S]*response = await bookRate\(purchaseRate\)/, "stale Veeqo booking errors must refresh and retry once");
assert.match(serverSource, /rateReviewNeedsScheduledRefresh\(row\.rateReview, lane\)/, "scheduled refresh must use provider-specific quote freshness");
assert.match(serverSource, /\/shipping\/api\/v1\/rates[\s\S]*signal: AbortSignal\.timeout\(15000\)/, "primary Veeqo rate requests must have a response deadline");
assert.match(serverSource, /const lookups = await Promise\.all\(identities\.map/, "Veeqo allocation fallback must search order identities concurrently");
assert.match(serverSource, /const allocationFallbackPromise = veeqoAllocationRatesForOrder[\s\S]*const response = await veeqoRequest\("\/shipping\/api\/v1\/rates"/, "Veeqo allocation fallback must start before the primary quote completes");
assert.match(dbSource, /'shippingRateReview', case[\s\S]*'selectedRate', case[\s\S]*'rates', case/, "compact order summaries must retain saved fulfillment rates after the console reloads");
assert.match(serverSource, /selectedRate: publicFulfillmentRate\(review\.selectedRate\)[\s\S]*review\.rates\.map\(publicFulfillmentRate\)/, "saved fulfillment rates must retain provider expiration and action metadata in the console snapshot");

const appSource = fs.readFileSync(path.join(__dirname, "..", "web", "src", "App.tsx"), "utf8");
assert.match(appSource, /if \(initializedOpenOrderRef\.current === orderId\) return/, "shipping-rate results must survive parent order refreshes while the dialog remains open");
assert.doesNotMatch(appSource, /setSelectedId\(defaultRateId\)\s*\n\s*await onUpdated\(\)/, "loading rates must not refresh and reset the open dialog");
assert.match(appSource, /rateLoadCompleted \|\| rates\.length \|\| blockers\.length/, "a completed empty lookup must not automatically retry forever");
assert.match(appSource, /const activeRouteIds = new Set[\s\S]*setSelectedRouteIds[\s\S]*activeRouteIds\.has\(routeId\)/, "completed fulfillment routes must be removed from the selected-rate toolbar after a reload");
assert.match(appSource, /order\.shippingRateReview[\s\S]*review: route\?\.shippingRateReview[\s\S]*: orderReview/, "order-level rates must reopen instantly when no warehouse route exists");
assert.match(appSource, /warehouseId: String\(initialRateReview\?\.warehouseId \|\| defaultShipFromWarehouseId \|\| order\.fulfillmentWarehouseId/, "cached rates must reopen with their quoted warehouse and new quotes must use the fulfillment default");
assert.match(serverSource, /for \(const route of activeRoutes\) route\.shippingRateReview = rateReview;\s*order\.shippingRateReview = rateReview;/, "successful manual rates must be cached on the order as well as warehouse routes");
assert.match(serverSource, /body\.warehouseId \|\| fulfillmentDefaultShipFromWarehouseId\(db, settings\) \|\| order\.fulfillmentWarehouseId/, "explicit ship-from choices must override the fulfillment default, which must override the inventory source");
assert.match(serverSource, /warehouseId: operationsSettings\.defaultShipFromWarehouseId \|\| ""/, "bulk label jobs must use the fulfillment ship-from default instead of the allocation warehouse");

console.log("Veeqo rate freshness tests passed.");
