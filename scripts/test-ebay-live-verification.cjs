const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const serverSource = fs.readFileSync(require.resolve("../server"), "utf8");
const dbSource = fs.readFileSync(require.resolve("../db"), "utf8");
const appSource = fs.readFileSync(require.resolve("../web/src/App.tsx"), "utf8");
const channelSource = fs.readFileSync(require.resolve("../web/src/components/channels-route.tsx"), "utf8");
const catalogSource = fs.readFileSync(require.resolve("../web/src/components/catalog-route.tsx"), "utf8");
const uiSource = `${appSource}\n${channelSource}\n${catalogSource}`;
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
  assert.match(uiSource, /eBay listing needs verification/);
  assert.match(uiSource, /Last verified live/);
});

test("offers and live-status sync is scheduled and deduplicated", () => {
  assert.match(serverSource, /ebayCatalogSyncScheduleEnabled: true/);
  assert.match(serverSource, /ebayCatalogSyncScheduleEveryHours: 6/);
  assert.match(serverSource, /findActiveImportJobByWorkerTask\(db, "ebay-catalog-sync"\)/);
  assert.match(workerSource, /checkScheduledEbayCatalogSync/);
  assert.match(workerSource, /queueEbayCatalogSyncJob/);
  assert.match(serverSource, /module\.exports = \{[\s\S]*queueEbayCatalogSyncJob,/);
  assert.match(workerSource, /channelEbayCatalogSyncSchedules/);
  assert.match(dbSource, /"channelEbayCatalogSyncSchedules"/);
  assert.match(uiSource, /Automatic schedule/);
  assert.match(uiSource, /eBay offers and live-status sync/);
  assert.match(uiSource, /Run offer\/status sync now/);
});

test("live launches automatically wait for a fresh complete active-listing feed", () => {
  assert.match(serverSource, /ebayRequireFreshStatusBeforeLaunch: true/);
  assert.match(serverSource, /ebayLaunchStatusMaxAgeHours: 6/);
  assert.match(serverSource, /readLatestOperationJobByWorkerTask\("ebay-catalog-sync"\)/);
  assert.match(serverSource, /prerequisiteJobId/);
  assert.match(serverSource, /did not produce a complete GetMyeBaySelling active-listing feed/);
  assert.match(dbSource, /readLatestOperationJobByWorkerTask/);
  assert.match(dbSource, /from operations_jobs prerequisite/);
  assert.match(uiSource, /Require fresh status before launch/);
});

test("retrying an eBay launch requests a fresh prerequisite instead of cloning the old sync", () => {
  assert.match(serverSource, /previous\.workerTask === "ebay-listing-launch"/);
  assert.match(serverSource, /delete nextPayload\.prerequisiteJobId/);
  assert.match(serverSource, /queueEbayListingLaunchJob\(retryDb, nextPayload/);
  assert.match(serverSource, /completed its GetMyeBaySelling feed, but that verification is older than/);
});

test("every worker schedule checkpoint is registered for persistence", () => {
  const scheduleDocuments = [...workerSource.matchAll(/writeStateDocuments\(\{\s*([A-Za-z0-9]+Schedules):/g)]
    .map((match) => match[1]);
  assert.ok(scheduleDocuments.length > 0);
  for (const document of new Set(scheduleDocuments)) {
    assert.match(dbSource, new RegExp(`"${document}"`), `${document} must be persisted by db.js`);
  }
});

test("full launch reviews persist a filterable readiness assessment", () => {
  assert.match(serverSource, /launchReadiness:/);
  assert.match(serverSource, /source: "eBay full launch validator"/);
  assert.match(serverSource, /expiresAt:/);
  assert.match(dbSource, /ebay-validated-ready/);
  assert.match(uiSource, /Ready to launch on eBay/);
  assert.match(uiSource, /Validate eBay readiness/);
});

test("eBay Promoted Listings uses a guarded two-percent cost-per-sale default", () => {
  assert.match(serverSource, /ebayPromotedListingsEnabled: false/);
  assert.match(serverSource, /ebayPromotedListingsRatePercent: 2/);
  assert.match(serverSource, /variableFeePercent: settings\.ebayPromotedListingsEnabled/);
  assert.match(serverSource, /fundingModel: "COST_PER_SALE"/);
  assert.match(serverSource, /bulk_create_ads_by_listing_id/);
  assert.match(serverSource, /promotionStatus: "failed"/);
  assert.match(serverSource, /sell\.marketing/);
  assert.match(channelSource, /Enable eBay ads/);
  assert.match(channelSource, /Default 2%/);
});

test("catalog exposes one binary eBay launch-readiness choice", () => {
  assert.match(appSource, /"ebay-validated-ready": "Ready to launch on eBay"/);
  assert.match(appSource, /"ebay-launch-not-ready": "Not ready to launch on eBay"/);
  assert.match(dbSource, /channelStatus === "ebay-launch-not-ready"/);
  assert.match(serverSource, /value === "ebay-launch-not-ready"/);
});

test("eBay readiness jobs use preflight terminology and automatic imports use the background lane", () => {
  assert.match(serverSource, /review: "eBay launch preflight"/);
  assert.match(serverSource, /background: body\.background === true \|\| options\.background === true/);
  assert.match(workerSource, /operation: "Post-import eBay launch preflight", background: true/);
  assert.match(uiSource, /Run eBay launch preflight/);
  assert.match(uiSource, /if \(isEbayLaunchPreflight\(job\)\) return "eBay launch preflight"/);
  assert.match(dbSource, /preflight\|readiness/);
  assert.match(dbSource, /%listing review%/);
});
