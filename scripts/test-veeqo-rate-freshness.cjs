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
assert.match(serverSource, /responseExpiresAt[\s\S]*expires_at: rate\.expires_at \|\| rate\.expiresAt \|\| responseExpiresAt/, "top-level Veeqo expiration must be copied onto every normalized quote");
assert.match(serverSource, /if \(veeqoRateNeedsRefresh\(purchaseRate\)\)[\s\S]*purchaseRate = await refreshSelectedRate/, "label purchase must refresh missing or expiring quotes");
assert.match(serverSource, /if \(!isStaleVeeqoRateError\(error\)\) throw error;[\s\S]*response = await bookRate\(purchaseRate\)/, "stale Veeqo booking errors must refresh and retry once");
assert.match(serverSource, /veeqoRateNeedsRefresh\(selectedRate, \{ safetyWindowMs: 15 \* 60_000 \}\)/, "scheduled refresh must prioritize Veeqo quotes expiring before the next cycle");
assert.match(serverSource, /\/shipping\/api\/v1\/rates[\s\S]*signal: AbortSignal\.timeout\(15000\)/, "primary Veeqo rate requests must have a response deadline");
assert.match(serverSource, /const lookups = await Promise\.all\(identities\.map/, "Veeqo allocation fallback must search order identities concurrently");

console.log("Veeqo rate freshness tests passed.");
