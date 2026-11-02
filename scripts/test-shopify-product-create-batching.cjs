const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const dbSource = fs.readFileSync(path.join(root, "db.js"), "utf8");
const catalogSource = fs.readFileSync(path.join(root, "web", "src", "components", "catalog-route.tsx"), "utf8");
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
assert.match(catalogSource, /allFiltered: true, selectionTotal: count, query, filters, apply, dryRun: !apply/, "catalog launch must send the complete filtered scope");
const queueSource = serverSource.slice(serverSource.indexOf("async function queueShopifyProductCreateJob"), serverSource.indexOf("async function queueShopifyProductStatusUpdateJob"));
assert.doesNotMatch(queueSource, /requestedSkus\.slice/, "Shopify create queue must not truncate explicit SKU selections");
assert.doesNotMatch(queueSource, /await postgresLiteState\(/, "Shopify create queue must not call the request-scoped response helper");
assert.doesNotMatch(queueSource, /postgresLiteStateResponse\(/, "Shopify create queue must not reload shared application state");
assert.match(queueSource, /return \{ job: normalizeImportJob\(job\) \}/, "Shopify create queue must return only the queued job");
const candidateStart = serverSource.indexOf("async function shopifyProductCreateCandidateKeys");
const candidateEnd = serverSource.indexOf("\nfunction appendFixedCsvRows", candidateStart);
const candidateSource = serverSource.slice(candidateStart, candidateEnd);
assert.match(candidateSource, /for \(let page = 1; productKeys\.length < maximum; page \+= 1\)/, "filtered Shopify candidates must be scanned in stable pages");
assert.match(candidateSource, /productKeys\.push\(key\)/, "filtered Shopify scans retain only lightweight product keys");
assert.doesNotMatch(candidateSource, /products\.push\(item\)/, "filtered Shopify scans must not retain every product record");
const createWorkerStart = serverSource.indexOf("async function runShopifyProductCreateWorkerJob");
const createWorkerEnd = serverSource.indexOf("\nfunction normalizeShopifyRequestedProductStatus", createWorkerStart);
const createWorkerSource = serverSource.slice(createWorkerStart, createWorkerEnd);
assert.match(createWorkerSource, /Math\.min\(1000, Number\(payload\.batchSize/, "Shopify create processing batches must stay memory bounded");
assert.match(createWorkerSource, /postgres\.readProductsByKeys\(batchKeys\)/, "Shopify create processing must load one product batch at a time");
assert.match(createWorkerSource, /readShopifyStatusMapStore\(batchKeys\)/, "Shopify status data must be scoped to the active batch");
assert.match(createWorkerSource, /appendFixedCsvRows\(skippedPath/, "Shopify skipped reports must stream to disk by batch");
const persistWorkerStart = serverSource.indexOf("async function persistWorkerImportJob");
const persistWorkerEnd = serverSource.indexOf("\nasync function runShopifyStatusSyncWorkerJob", persistWorkerStart);
const persistWorkerSource = serverSource.slice(persistWorkerStart, persistWorkerEnd);
assert.match(persistWorkerSource, /workerLastSeenAt:\s*job\.workerId\s*\?\s*updatedAt/, "active external worker progress must refresh the job heartbeat");
assert.match(catalogSource, /label: "Launch Shopify"/, "catalog action must use the concise Shopify launch label");
assert.match(catalogSource, /label: "Review Shopify drafts"/, "catalog actions must expose a safe incomplete-product draft review");
assert.match(catalogSource, /label: "Create Shopify drafts"/, "catalog actions must expose unpublished Shopify draft creation");
assert.match(catalogSource, /allowDraftIncomplete \}/, "catalog draft actions must pass the incomplete-draft scope to the worker");
for (const [name, next] of [["writeStateDocuments", "registerDatadumpSuppliers"], ["upsertShopifyStatusMap", "replaceProductQualityRows"]]) {
  const transactionSource = dbSource.slice(dbSource.indexOf(`async function ${name}`), dbSource.indexOf(`async function ${next}`, dbSource.indexOf(`async function ${name}`)));
  assert.match(transactionSource, /const client = await pool\.connect\(\)/, `${name} must reserve one PostgreSQL client for its transaction`);
  assert.match(transactionSource, /finally\s*{\s*client\.release\(\)/, `${name} must release its PostgreSQL transaction client`);
}

console.log("Shopify product creation batching checks passed.");
