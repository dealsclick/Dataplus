const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const serverSource = fs.readFileSync(require.resolve("../server"), "utf8");
const dbSource = fs.readFileSync(require.resolve("../db"), "utf8");
const appSource = fs.readFileSync(require.resolve("../web/src/App.tsx"), "utf8");
const workerSource = fs.readFileSync(require.resolve("./dataplus-worker"), "utf8");
const helperStart = serverSource.indexOf("function ebayListingIsVerifiedLive(");
const helperEnd = serverSource.indexOf("\nfunction catalogProductEbayReadinessStatus(", helperStart);
const helpers = vm.runInNewContext(
  `${serverSource.slice(helperStart, helperEnd)}\n({ ebayListingIsVerifiedLive, catalogProductEbayStatus })`
);

test("a historical listing ID is not enough to claim an eBay listing is live", () => {
  assert.equal(helpers.catalogProductEbayStatus({ ebayListing: { listingId: "123" } }), "unverified");
  assert.equal(helpers.ebayListingIsVerifiedLive({ listingId: "123" }), false);
});

test("only a verified active or published listing is live", () => {
  const listing = {
    listingId: "123",
    liveState: "live",
    liveVerifiedAt: "2026-09-23T12:00:00.000Z",
    liveVerificationSource: "GetMyeBaySelling active-listing feed",
    ebayStatus: "Active"
  };
  assert.equal(helpers.ebayListingIsVerifiedLive(listing), true);
  assert.equal(helpers.catalogProductEbayStatus({ ebayListing: listing }), "live");
  assert.equal(helpers.catalogProductEbayStatus({ ebayListing: { ...listing, liveState: "not_live", ebayStatus: "NOT_ACTIVE" } }), "unverified");
});

test("catalog sync exposes GetMyeBaySelling progress and guarded reconciliation", () => {
  assert.match(serverSource, /GetMyeBaySelling active-listing feed: fetched/);
  assert.match(serverSource, /if \(tradingResult\.complete\)/);
  assert.match(serverSource, /no stored live statuses were demoted/);
  assert.match(dbSource, /reconcileEbayActiveListings/);
  assert.match(dbSource, /liveVerifiedAt/);
  assert.match(appSource, /eBay listing needs verification/);
  assert.match(appSource, /Last verified live/);
});

test("offers and live-status sync is scheduled and deduplicated", () => {
  assert.match(serverSource, /ebayCatalogSyncScheduleEnabled: true/);
  assert.match(serverSource, /ebayCatalogSyncScheduleTimes: "02:00"/);
  assert.match(serverSource, /findActiveImportJobByWorkerTask\(db, "ebay-catalog-sync"\)/);
  assert.match(workerSource, /checkScheduledEbayCatalogSync/);
  assert.match(workerSource, /queueEbayCatalogSyncJob/);
  assert.match(serverSource, /module\.exports = \{[\s\S]*queueEbayCatalogSyncJob,/);
  assert.match(workerSource, /channelEbayCatalogSyncSchedules/);
  assert.match(dbSource, /"channelEbayCatalogSyncSchedules"/);
  assert.match(appSource, /Automatic schedule/);
  assert.match(appSource, /eBay offers and live-status sync/);
  assert.match(appSource, /Run offer\/status sync now/);
});

test("full launch reviews persist a filterable readiness assessment", () => {
  assert.match(serverSource, /launchReadiness:/);
  assert.match(serverSource, /source: "eBay full launch validator"/);
  assert.match(serverSource, /expiresAt:/);
  assert.match(dbSource, /ebay-validated-ready/);
  assert.match(appSource, /eBay preflight passed \(24h\)/);
  assert.match(appSource, /Validate eBay readiness/);
});
