const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");
const { shopifyProductCreateReadiness } = require(path.join(root, "server.js"));

const readiness = shopifyProductCreateReadiness({
  systemSettings: { catalogRequireCategoryForLaunch: false, catalogRequireImageForLaunch: false },
  channels: [{ name: "Shopify", enabled: true, settings: { shippingMissingMeasurementsAllowed: true } }],
  vendors: []
}, {
  sku: "ZERO-STOCK-TEST",
  title: "Zero stock product",
  description: "May be created before inventory arrives.",
  vendor: "Test supplier",
  websitePrice: 10,
  qty: 0,
  status: "active"
});

assert.equal(readiness.missing.includes("Inventory qty"), false, "zero inventory must not block Shopify product creation");
assert.match(appSource, /allFiltered: true, selectionTotal: count, query, filters, apply, dryRun: !apply/, "catalog launch must send the complete filtered scope");
const queueSource = serverSource.slice(serverSource.indexOf("async function queueShopifyProductCreateJob"), serverSource.indexOf("async function queueShopifyProductStatusUpdateJob"));
assert.doesNotMatch(queueSource, /requestedSkus\.slice/, "Shopify create queue must not truncate explicit SKU selections");
assert.doesNotMatch(queueSource, /await postgresLiteState\(/, "Shopify create queue must not call the request-scoped response helper");
assert.match(queueSource, /await postgresLiteStateResponse\(/, "Shopify create queue must use the shared lightweight response helper");
assert.match(serverSource, /for \(let page = 1; products\.length < maximum; page \+= 1\)/, "filtered Shopify candidates must be loaded in pages");
assert.match(appSource, /label: "Launch Shopify"/, "catalog action must use the concise Shopify launch label");

console.log("Shopify product creation batching checks passed.");
