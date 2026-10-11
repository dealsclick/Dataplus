const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "web", "src", "App.tsx"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

assert.match(appSource, /selectedPurchaseEligiblePackageEntries = \[\.\.\.selectedPackageGroups\.entries\(\)\]\.filter\([\s\S]*readinessFor\(row\)\.ready === true && Boolean\(row\.rateReview\?\.selectedRate\)/, "purchase eligibility must require complete shipment data and a selected rate for the whole package");
assert.match(appSource, /const purchaseRouteIds = selectedPurchaseEligibleRows\.map/, "label batches must receive only eligible route IDs");
assert.match(appSource, /onClick=\{\(\) => setBatchOpen\(true\)\}[\s\S]*Buy \$\{selectedPurchaseEligiblePackages\.length\}/, "the bulk button must open a confirmation summary before purchasing");
assert.match(appSource, /Ready to buy[\s\S]*Skipped[\s\S]*selectedPurchaseSkippedCount/, "the purchase summary must show eligible and skipped counts");
assert.match(appSource, /labelPurchaseProgress\?\.total \|\| selectedPurchaseEligiblePackages\.length/, "idle purchase progress must use the eligible label count");
assert.match(appSource, /disabled=\{busy \|\| !selectedPurchaseEligibleRows\.length\}/, "mixed selections must stay purchasable when at least one package is eligible");
assert.doesNotMatch(appSource, /ratedRows\.length !== selectedRows\.length/, "an ineligible row must not block every selected label");

assert.match(serverSource, /activeFulfillmentLabelBatchAssignments\(state\.batches\)/, "the server must exclude routes already assigned to an active label batch");
assert.match(serverSource, /rows = rows\.filter\(\(row\) => row\.status === "rated"\)/, "the server must retain only rated rows when creating a purchase batch");
assert.match(serverSource, /routeIds: eligibleRouteIds/, "the purchase worker must receive only routes still eligible in the saved batch");

console.log("Fulfillment bulk label selection tests passed.");
