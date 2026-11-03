const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = ["App.tsx", "components/fulfillment-route.tsx"].map((file) => fs.readFileSync(path.join(__dirname, "..", "web", "src", ...file.split("/")), "utf8")).join("\n");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

assert.match(appSource, /selectedPurchaseEligiblePackageEntries = selectedRateReadyPackageEntries\.filter\(\(\[, packageRows\]\) => Boolean\(fulfillmentSharedRateRow\(packageRows\)\?\.rateReview\?\.selectedRate\)\)/, "purchase eligibility must require complete shipment data and one selected shared rate per physical package");
assert.match(appSource, /function fulfillmentRateIsCurrent[\s\S]*validUntil === null \|\| validUntil > now/, "saved provider rates must remain purchasable until their real validity window ends");
assert.match(appSource, /rate\.quotedAt \|\| review\?\.ratedAt \|\| review\?\.attemptedAt[\s\S]*FULFILLMENT_SAVED_RATE_TTL_MS/, "providers without an explicit expiration must use the saved quote timestamp and fallback TTL");
assert.match(appSource, /latestRateAuthorization\.selectionKey === selectedRouteIdsKey/, "the completed-job fallback must belong to the exact current selection");
assert.match(appSource, /selectedRateReadyPackageEntries\.every\(\(\[, packageRows\]\) => Boolean\(fulfillmentSharedRateRow\(packageRows\)\?\.rateReview\?\.selectedRate\)\)/, "every ready physical package must have one selected quote before purchase can begin");
assert.match(appSource, /selectedPurchaseEligibleRows = selectedPurchaseEligiblePackageEntries\.flatMap\(\(\[, packageRows\]\) => fulfillmentPackageOwnerRows\(packageRows\)\)/, "combined shipments must submit only the shared rate owner to label purchase");
assert.match(appSource, /Shared group rate · covers \$\{memberOrders\.length\} orders/, "combined shipment rows must label the one quote as shared");
assert.match(appSource, /const clusterTitle = persistedCombinedShipment \? "Combined shipment"[\s\S]*const clusterBadge = persistedCombinedShipment \? `\$\{clusterOrderCount\} orders · 1 label`/, "combined shipment members must collapse beneath one master row");
assert.match(appSource, /const purchaseRouteIds = inlineShipmentGroup \? inlineRouteIds : purchaseRows\.map/, "label batches must receive the saved shipment-group routes or only eligible bulk route IDs");
assert.match(appSource, /onClick=\{\(\) => setBatchOpen\(true\)\}[\s\S]*Buy \$\{selectedPurchaseEligiblePackages\.length\}/, "the bulk button must open a confirmation summary before purchasing");
assert.match(appSource, /Ready to buy[\s\S]*Skipped[\s\S]*selectedPurchaseSkippedCount/, "the purchase summary must show eligible and skipped counts");
assert.match(appSource, /labelPurchaseProgress\?\.total \|\| selectedPurchaseEligiblePackages\.length/, "idle purchase progress must use the eligible label count");
assert.match(appSource, /disabled=\{busy \|\| rateRefreshProgress\.active \|\| !selectedRatesCurrent \|\| !selectedPurchaseEligibleRows\.length\}/, "bulk purchase must stay disabled until the latest rate refresh completes for the current selection");
assert.match(appSource, /Refresh rates before buying/, "the disabled bulk purchase control must explain the required next step");
assert.match(appSource, /Get latest rates for \$\{selectedRateReadyPackages\.length\}/, "the purchase dialog must offer the same latest-rate step for a single shipment");
assert.doesNotMatch(appSource, /ratedRows\.length !== selectedRows\.length/, "an ineligible row must not block every selected label");
assert.match(appSource, /const clusterTitle = persistedCombinedShipment \? "Combined shipment" : "Suggested combination"/, "saved and suggested group members must remain visibly clustered in the fulfillment table");
assert.match(appSource, /continueShipmentGroup\(true, true\)/, "the shipment-group modal must keep its inline rate workflow open");
assert.match(appSource, /Buy & print label/, "the shipment-group modal must purchase and print its shared label directly");
assert.match(appSource, /consolidationPurchaseInlineRef\.current = inlineShipmentGroup/, "inline shipment-group purchases must retain their print handoff context");
assert.match(appSource, /matchesPrintJob[\s\S]*matchesPrintRequest[\s\S]*matchesBatch/, "completed purchases must find their print packet by job, request, or batch identity");
assert.match(appSource, /setPendingPrintRecovery\(\{ batchId: String\(job\.labelPurchaseBatchId\), inlineShipmentGroup: purchasedFromShipmentGroup, shipmentGroupId:/, "a completed purchase must keep polling when its print packet trails the carrier job");
assert.match(appSource, /setConsolidationPrintJob\(printJobs\[0\]\)[\s\S]*openPrintPreview\(printJobs\[0\]\)/, "an inline shipment group must retain and open its purchased print packet");
assert.match(appSource, /Label purchased and ready to print[\s\S]*Open & print label/, "the open shipment-group modal must expose its purchased label immediately");
assert.match(appSource, /Label purchased; preparing print packet[\s\S]*checking every two seconds/, "the modal must show print-document progress without offering a duplicate purchase");
assert.match(appSource, /const consolidationSelectedRate = consolidationRateReview\?\.selectedRate/, "the shipment-group modal must retain its rate independently of the visible fulfillment page");
assert.match(appSource, /consolidationPrimaryRouteIdsRef\.current[\s\S]*reviewsByRoute\.get\(routeId\)/, "background rate results must hydrate the saved shipment group before the table reloads");
assert.match(appSource, /const targets = packageTargetRows\.filter/, "bulk package saves must use the records captured when the editor opened");
assert.doesNotMatch(appSource, /purchasedFromShipmentGroup && printJobs\.length[\s\S]*setConsolidationOrder\(null\)/, "the shipment-group dialog must stay open after purchase so its print action remains available");

assert.match(serverSource, /activeFulfillmentLabelBatchAssignments\(state\.batches\)/, "the server must exclude routes already assigned to an active label batch");
assert.match(serverSource, /primaryOrderId: order\.id, primaryRouteIds/, "shipment-group creation must return only the primary combined package routes");
assert.match(serverSource, /rows = rows\.filter\(\(row\) => row\.status === "rated"\)/, "the server must retain only rated rows when creating a purchase batch");
assert.match(serverSource, /routeIds: eligibleRouteIds/, "the purchase worker must receive only routes still eligible in the saved batch");

console.log("Fulfillment bulk label selection tests passed.");
