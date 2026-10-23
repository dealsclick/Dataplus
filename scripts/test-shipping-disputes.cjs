const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const database = fs.readFileSync(path.join(root, "db.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "scripts", "dataplus-worker.js"), "utf8");
const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");
const page = fs.readFileSync(path.join(root, "web", "src", "components", "shipping-disputes.tsx"), "utf8");
const { completePackage, completeDestination, selectLowestRates, normalizeReferenceEvidence, orderLinesForDispute, enrichOrderLinesWithProducts, disputeSkus } = require("../lib/shipping-disputes");
const ups = require("../lib/ups-rating");
const disputeStore = fs.readFileSync(path.join(root, "lib", "shipping-disputes.js"), "utf8");

for (const table of ["shipping_dispute_batches", "shipping_dispute_items", "shipping_dispute_quote_runs", "shipping_dispute_quotes"]) {
  assert.match(database, new RegExp(`create table if not exists ${table}\\b`), `${table} must be schema-managed`);
}
assert.match(database, /check \(rank between 1 and 5\)/, "stored comparison rates must be capped to ranks 1-5");
assert.match(server, /comparisonOnly: true/, "dispute jobs must use quote-only rate shopping");
assert.match(server, /shippingDisputeStore\.finishRun/, "quote results must be persisted through the dispute store");
assert.match(server, /shippingDisputeExportCsv/, "shipment-level dispute evidence must be exportable");
assert.match(server, /Shipping disputes are available only for LINQ/, "operational shipment evidence must stay inside the current LINQ boundary");
assert.match(disputeStore, /update shipping_dispute_items item set status='quoting'/, "a rerun must keep every eligible item visibly in progress");
assert.match(disputeStore, /where lower\(order_id\)=any\(\$1::text\[\]\)/, "bulk dispute matching must use one bounded order lookup");
assert.match(disputeStore, /from order_line_items where order_id=any\(\$1::text\[\]\)/, "matched orders must load canonical line items in one bounded query");
assert.match(disputeStore, /join product_aliases alias on lower\(alias\.alias_sku\)=requested\.key/, "SKU aliases must resolve to catalog display metadata");
assert.match(disputeStore, /productMetadataForOrderLines\(client/, "dispute line images must use one bounded catalog enrichment query");
assert.match(disputeStore, /DISPUTE_REFERENCE_LIMIT = 50_000/, "one user-visible dispute must support a large uploaded statement");
assert.match(disputeStore, /for \(const referenceChunk of chunks\(normalizedReferences\)\)/, "large disputes must keep order matching internally bounded");
assert.match(disputeStore, /jsonb_to_recordset\(\$1::jsonb\)/, "large disputes must bulk-insert shipment evidence instead of issuing one query per row");
assert.match(disputeStore, /cardinality\(\$4::text\[\]\)=0 or item\.item_id=any\(\$4::text\[\]\)/, "only selected dispute rows should be marked as quoting");
assert.doesNotMatch(disputeStore, /from unnest\([^)]*\)[\s\S]{0,160}left join lateral/, "bulk dispute matching must not rescan orders once per reference");
assert.match(worker, /shipping-dispute-quotes/, "the external worker must support dispute quote jobs");
assert.match(app, /shipping-disputes/, "the React router must expose Shipping Disputes");
assert.match(page, /Quotes are evidence only and never alter orders, labels, or settlements/, "the UI must explain the non-mutating workflow");
assert.match(page, /await import\("xlsx"\)/, "Excel parsing must remain outside the default Shipping Disputes bundle");
assert.match(page, /\.csv,\.txt,\.xlsx,\.xls/, "the dispute uploader must accept CSV, text, and Excel workbooks");
assert.match(page, /CSV, TXT, XLSX, or XLS/, "the dispute dialog must disclose every supported upload format");
assert.match(page, /file\.size > 10 \* 1024 \* 1024/, "browser uploads must have a bounded workbook size");
assert.match(page, /shipping label purchase adjustment/, "Temu reports must filter to shipping-label purchase adjustments");
assert.match(page, /DISPUTE_REFERENCE_LIMIT = 50_000/, "the upload UI must enforce the same one-dispute reference limit as the server");
assert.match(page, /referenceEvidence: temuReport\?\.evidence \|\| \[\]/, "all Temu evidence must be sent into one dispute");
assert.doesNotMatch(page, /batchIndex|numbered review batches/, "the browser must not split one upload into multiple visible disputes");
assert.match(page, /Load matching orders/, "the first workflow transition must load orders without quoting them");
assert.match(page, /Quote filtered/, "operators must be able to quote SKU-filtered shipment rows");
assert.match(page, /Matched: Yes/, "operators must be able to isolate matched order rows");
assert.match(page, /Matched: No/, "operators must be able to isolate unmatched order rows");
assert.match(page, /Net charges/, "operators must be able to isolate statement charges");
assert.match(page, /Net credits/, "operators must be able to isolate statement credits");
assert.match(page, /visibleReadyIds/, "hidden selections must not bypass the active dispute filters");
assert.match(page, /DISPUTE_PAGE_SIZE = 100/, "large single disputes must paginate their rendered rows");
assert.match(page, /Quote selected/, "operators must be able to quote a selected subset");
assert.match(page, /Request current rates/, "operators must be able to quote an individual shipment");
assert.match(page, /Filter order, channel order, tracking, or SKU/, "the review workspace must search normalized SKUs");
assert.match(page, /Filter shipments by SKU/, "the dispute workspace must use the Fulfillment-style SKU picker");
assert.match(page, /selectedSkuFilters/, "operators must be able to combine multiple SKU filters");
assert.match(page, /loading="lazy" onError=\{\(\) => setFailed\(true\)\}/, "SKU images must load lazily and fall back when a remote image fails");
assert.match(server, /itemIds: requestedItemIds/, "selected dispute item IDs must be carried by the background job");
assert.match(server, /Temu statement signed amount/, "Temu adjustment evidence must be included in the dispute export");
assert.match(disputeStore, /importEvidence/, "Temu adjustment evidence must be retained on dispute items");

assert.equal(completePackage({ weight: 1, length: 2, width: 3, height: 4 }), true);
assert.equal(completePackage({ weight: 1, length: 2, width: 3, height: 0 }), false);
assert.equal(completeDestination({ line1: "1 Main St", city: "New York", state: "NY", postalCode: "10001", country: "US" }), true);
assert.equal(completeDestination({ city: "New York", state: "NY", postalCode: "10001", country: "US" }), false);

const selectedRates = selectLowestRates([
  { provider: "veeqo", carrier: "UPS", service: "Ground", amount: 14 },
  { provider: "ups_direct", carrier: "UPS", service: "Ground", amount: 11 },
  { provider: "ups_direct", carrier: "UPS", service: "Ground", amount: 11 },
  { provider: "veeqo", carrier: "USPS", service: "Ground Advantage", amount: 8 },
  { provider: "veeqo", carrier: "FedEx", service: "Home", amount: 12 },
  { provider: "veeqo", carrier: "UPS", service: "SurePost", amount: 9 },
  { provider: "veeqo", carrier: "USPS", service: "Priority", amount: 10 },
  { provider: "invalid", carrier: "None", service: "None", amount: 0 },
]);
assert.deepEqual(selectedRates.map((rate) => rate.amount), [8, 9, 10, 11, 12], "only the five cheapest unique positive rates should be retained");

const adjustmentEvidence = normalizeReferenceEvidence([{ reference: "PO-123", transactions: [
  { rowNumber: 2, date: "2026-10-01", relatedId: "A", signedAmount: -12.5, total: -12.5, currency: "USD" },
  { rowNumber: 3, date: "2026-10-02", relatedId: "B", signedAmount: 2, total: 2, currency: "USD" },
] }]).get("po-123");
assert.equal(adjustmentEvidence.signedAmount, -10.5, "the original Temu statement sign must be retained");
assert.equal(adjustmentEvidence.expenseAmount, 10.5, "Temu debits must normalize to positive shipping expense");
assert.deepEqual(adjustmentEvidence.relatedIds, ["A", "B"], "every Temu adjustment reference must remain auditable");

const normalizedLines = orderLinesForDispute([
  { line_id: "line-1", line_index: 0, sku: "CHANNEL-1", mapped_sku: "CATALOG-1", original_sku: "ORIGINAL-1", title: "First item", qty: 2, raw: { imageUrl: "https://example.test/order-line.jpg" } },
  { line_id: "line-2", line_index: 1, sku: "CHANNEL-2", title: "Second item", qty: 1 },
]);
assert.deepEqual(normalizedLines.map((line) => line.mappedSku || line.sku), ["CATALOG-1", "CHANNEL-2"], "canonical and channel SKU identities must remain available for review");
assert.deepEqual(disputeSkus(normalizedLines), ["CATALOG-1", "CHANNEL-1", "ORIGINAL-1", "CHANNEL-2"], "SKU filtering must match mapped, current, and original channel SKUs");
const enrichedLines = enrichOrderLinesWithProducts(normalizedLines, new Map([
  ["catalog-1", { sku: "CATALOG-1", title: "Catalog title", brand: "Acme", supplier: "True Value", default_image: "https://example.test/catalog.jpg" }],
  ["channel-2", { sku: "CATALOG-2", title: "Second catalog title", brand: "Beta", supplier: "Internal stock", default_image: "https://example.test/catalog-2.jpg" }],
]));
assert.equal(enrichedLines[0].image, "https://example.test/order-line.jpg", "the imported line image must remain the first display choice");
assert.equal(enrichedLines[0].brand, "Acme", "missing display metadata must be enriched from the catalog");
assert.equal(enrichedLines[1].catalogSku, "CATALOG-2", "channel SKUs must link to the matched canonical catalog SKU");
assert.equal(enrichedLines[1].image, "https://example.test/catalog-2.jpg", "catalog images must fill missing imported thumbnails");

const status = ups.publicStatus({ UPS_RATING_ENABLED: "true", UPS_CLIENT_ID: "id", UPS_CLIENT_SECRET: "secret", UPS_ACCOUNT_NUMBER: "ABC123" });
assert.equal(status.configured, true);
assert.equal(status.accountEnding, "C123");
assert.equal(Object.prototype.hasOwnProperty.call(status, "clientSecret"), false, "public UPS status must not expose credentials");

console.log("Shipping disputes checks passed.");
