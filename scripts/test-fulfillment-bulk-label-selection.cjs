const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "web", "src", "App.tsx"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

assert.match(appSource, /selectedPurchaseEligiblePackageEntries = selectedRatesCurrent[\s\S]*selectedPackageGroups\.entries\(\)[\s\S]*readinessFor\(row\)\.ready === true && Boolean\(row\.rateReview\?\.selectedRate\) && routeHasCurrentRate\(row\)/, "purchase eligibility must require complete shipment data and a current selected rate for the whole package");
assert.match(appSource, /function fulfillmentRateIsCurrent[\s\S]*validUntil === null \|\| validUntil > now/, "saved provider rates must remain purchasable until their real validity window ends");
assert.match(appSource, /rate\.quotedAt \|\| review\?\.ratedAt \|\| review\?\.attemptedAt[\s\S]*FULFILLMENT_SAVED_RATE_TTL_MS/, "providers without an explicit expiration must use the saved quote timestamp and fallback TTL");
assert.match(appSource, /latestRateAuthorization\.selectionKey === selectedRouteIdsKey/, "the completed-job fallback must belong to the exact current selection");
assert.match(appSource, /selectedRateReadyRows\.every\(routeHasCurrentRate\)/, "every ready route must have either a still-valid saved quote or coverage from the just-completed refresh");
assert.match(appSource, /const purchaseRouteIds = selectedPurchaseEligibleRows\.map/, "label batches must receive only eligible route IDs");
assert.match(appSource, /onClick=\{\(\) => setBatchOpen\(true\)\}[\s\S]*Buy \$\{selectedPurchaseEligiblePackages\.length\}/, "the bulk button must open a confirmation summary before purchasing");
assert.match(appSource, /Ready to buy[\s\S]*Skipped[\s\S]*selectedPurchaseSkippedCount/, "the purchase summary must show eligible and skipped counts");
assert.match(appSource, /labelPurchaseProgress\?\.total \|\| selectedPurchaseEligiblePackages\.length/, "idle purchase progress must use the eligible label count");
assert.match(appSource, /disabled=\{busy \|\| rateRefreshProgress\.active \|\| !selectedRatesCurrent \|\| !selectedPurchaseEligibleRows\.length\}/, "bulk purchase must stay disabled until the latest rate refresh completes for the current selection");
assert.match(appSource, /Refresh rates before buying/, "the disabled bulk purchase control must explain the required next step");
assert.match(appSource, /Get latest rates for \$\{selectedRateReadyPackages\.length\}/, "the purchase dialog must offer the same latest-rate step for a single shipment");
assert.doesNotMatch(appSource, /ratedRows\.length !== selectedRows\.length/, "an ineligible row must not block every selected label");

assert.match(serverSource, /activeFulfillmentLabelBatchAssignments\(state\.batches\)/, "the server must exclude routes already assigned to an active label batch");
assert.match(serverSource, /rows = rows\.filter\(\(row\) => row\.status === "rated"\)/, "the server must retain only rated rows when creating a purchase batch");
assert.match(serverSource, /routeIds: eligibleRouteIds/, "the purchase worker must receive only routes still eligible in the saved batch");

console.log("Fulfillment bulk label selection tests passed.");
