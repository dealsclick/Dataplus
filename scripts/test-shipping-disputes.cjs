const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const database = fs.readFileSync(path.join(root, "db.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "scripts", "dataplus-worker.js"), "utf8");
const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");
const page = fs.readFileSync(path.join(root, "web", "src", "components", "shipping-disputes.tsx"), "utf8");
const { completePackage, completeDestination, postalDestination, destinationQuoteBasis, selectLowestRates, normalizeReferenceEvidence, orderLinesForDispute, enrichOrderLinesWithProducts, catalogQuotePackage, disputeSkus, sameQuotePackage, quoteEvidenceIsCurrent } = require("../lib/shipping-disputes");
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
assert.match(disputeStore, /catalogQuotePackage\(enrichedLines, productMetadata\)/, "existing disputes must hydrate quote packages from current catalog measurements");
assert.doesNotMatch(disputeStore, /!currentSource\.startsWith\("current_catalog_"\)/, "catalog-backed dispute packages must refresh after SKU measurements change");
assert.match(disputeStore, /historicalPackage/, "historical label package evidence must remain retained separately");
assert.match(disputeStore, /!\["quoted", "quoting"\]\.includes\(row\.status\)/, "saved quote runs must keep the package snapshot they were rated with");
assert.match(disputeStore, /quoted_at=incoming\.quoted_at/, "catalog measurement changes must clear the prior quote timestamp");
assert.match(disputeStore, /staleQuoteEvidence/, "a quote made before the current package must return to the quote-ready workflow");
assert.match(disputeStore, /DISPUTE_REFERENCE_LIMIT = 50_000/, "one user-visible dispute must support a large uploaded statement");
assert.match(disputeStore, /for \(const referenceChunk of chunks\(normalizedReferences\)\)/, "large disputes must keep order matching internally bounded");
assert.match(disputeStore, /jsonb_to_recordset\(\$1::jsonb\)/, "large disputes must bulk-insert shipment evidence instead of issuing one query per row");
assert.match(disputeStore, /JSON\.stringify\(rows\)/, "bulk dispute inserts must send valid JSON instead of a PostgreSQL array literal");
assert.match(disputeStore, /JSON\.stringify\(updateChunk\)/, "catalog package reconciliation must send valid JSON instead of a PostgreSQL array literal");
assert.match(disputeStore, /cardinality\(\$4::text\[\]\)=0 or item\.item_id=any\(\$4::text\[\]\)/, "only selected dispute rows should be marked as quoting");
assert.match(disputeStore, /async function quoteItemIds/, "large quote requests must select ready item IDs without hydrating the complete dispute");
assert.match(disputeStore, /select item\.\*\s+from shipping_dispute_items item/, "each quote worker must load only its bounded shipment rows");
assert.match(disputeStore, /input\.refreshBatch !== false/, "per-row quote persistence must be able to defer full dispute recounts");
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
assert.match(page, /Based on full address/, "operators must be able to isolate full-address comparisons");
assert.match(page, /Based on ZIP/, "operators must be able to isolate ZIP-based comparisons");
assert.match(page, /Address: Needs ZIP/, "operators must be able to isolate destinations without postal evidence");
for (const label of ["Channel order number", "Order date", "Ship date", "Tracking number"]) {
  assert.match(page, new RegExp(label), `comparison rates must display ${label.toLowerCase()}`);
}
for (const label of ["Quoted weight", "Quoted dimensions"]) {
  assert.match(page, new RegExp(label), `comparison rates must display ${label.toLowerCase()}`);
}
assert.match(page, /sm:grid-cols-5/, "comparison order details should stay compact on desktop");
assert.match(page, /max-w-\[45%\].*overflow-x-auto/, "comparison SKUs should stay on one bounded horizontally scrollable line");
assert.match(page, /title=\{productTitle\}/, "comparison rates should show the product title with the full value available on hover");
assert.match(page, /flex-1 truncate text-xs text-muted-foreground/, "comparison product titles should remain on one truncated line");
assert.doesNotMatch(page, /Rated from the stored destination address/, "comparison rates should not repeat the address basis");
assert.doesNotMatch(page, /Supporting evidence, not a historical re-rate/, "comparison rates should not show the historical-rate notice");
for (const label of ["Temu cost comparison", "Original charge", "Temu adjustment", "Rate received", "Charge difference"]) {
  assert.match(page, new RegExp(label), `comparison rates must display ${label.toLowerCase()}`);
}
assert.match(page, /temuTotal - Number\(quote\.amount\)/, "the Temu charge difference must compare the original charge plus imported adjustment with each current quote");
assert.match(page, /Dimensions: Complete/, "operators must be able to isolate complete quote dimensions");
assert.match(page, /Dimensions: Missing/, "operators must be able to isolate incomplete quote dimensions");
assert.match(page, /addressFilter, detail\?\.items, dimensionsFilter/, "address and dimension filters must participate in the visible shipment set");
assert.match(page, /adjustment >= 0/, "Temu intake must ignore credits and zero-value adjustments");
assert.match(page, /non-charge rows ignored/, "the upload preview must disclose excluded rows");
assert.doesNotMatch(page, /Net credits/, "the charge-only dispute workflow must not expose a credit filter");
assert.match(page, /visibleReadyIds/, "hidden selections must not bypass the active dispute filters");
assert.match(page, /DISPUTE_PAGE_SIZE = 100/, "large single disputes must paginate their rendered rows");
assert.match(page, /Quote selected/, "operators must be able to quote a selected subset");
assert.match(page, /Request current rates/, "operators must be able to quote an individual shipment");
assert.match(page, /Filter order, channel order, tracking, or SKU/, "the review workspace must search normalized SKUs");
assert.match(page, /Filter shipments by SKU/, "the dispute workspace must use the Fulfillment-style SKU picker");
assert.match(page, /selectedSkuFilters/, "operators must be able to combine multiple SKU filters");
assert.match(page, /Current catalog SKU/, "the quote package source must clearly identify current catalog measurements");
assert.match(page, /Direct UPS/, "saved quote runs must identify direct UPS separately from Veeqo carrier services");
assert.match(page, /No rate ranked in the saved top five/, "provider diagnostics must explain when a successful provider falls outside the retained top five");
assert.match(server, /cheapestAmount/, "quote evidence must retain provider-level rate coverage without storing more than five rates");
assert.match(page, /Temu reports are not expected to include dimensions/, "the UI must explain that Temu adjustments do not provide package measurements");
assert.match(page, /loading="lazy" onError=\{\(\) => setFailed\(true\)\}/, "SKU images must load lazily and fall back when a remote image fails");
assert.match(server, /SHIPPING_DISPUTE_QUOTE_JOB_SIZE = 100/, "large quote runs must use bounded background jobs");
assert.match(server, /shippingDisputeQuoteChunks\(readyItemIds\)/, "every ready shipment must be split into bounded quote jobs");
assert.match(server, /prerequisiteJobId: prerequisiteJob\?\.id \|\| ""/, "quote chunks must be chained so only one chunk advances at a time");
assert.match(server, /chunkIndex === totalChunks[\s\S]{0,120}completeBatch/, "only the final quote chunk may complete the dispute batch");
assert.doesNotMatch(server, /Request rates for at most 1,000 shipment rows at a time/, "quote requests must not expose a fixed row ceiling");
assert.match(server, /Temu statement signed charge/, "Temu charge evidence must be included in the dispute export");
assert.match(server, /Quote address basis/, "the dispute export must identify full-address and ZIP-based quotes");
assert.match(server, /allowPostalOnlyDestination: addressQuoteBasis === "postal_code"/, "ZIP-only disputes must explicitly opt into direct UPS postal rating");
assert.match(server, /postalOnlyComparison/, "ZIP-only disputes must avoid unsupported full-address provider work");
assert.match(disputeStore, /nullif\(item\.destination_postal_code,''\) is not null/, "a destination postal code must be sufficient for dispute quote selection");
assert.match(disputeStore, /select order_id,order_date,created_at/, "existing disputes must hydrate order dates from order records");
assert.match(disputeStore, /select order_id,shipment_id,tracking_number,shipped_at/, "existing disputes must hydrate ship dates from shipment financials");
assert.match(disputeStore, /latest\.request_snapshot as latest_run_request_snapshot/, "comparison details must expose the exact saved quote request");
assert.match(server, /orderLines: item\.orderLines/, "future quote snapshots must retain SKU lines and quantities");
assert.match(disputeStore, /orderDate: timestamp\(order\.order_date/, "new disputes must snapshot the source order date");
assert.match(disputeStore, /shipDate: timestamp\(shipment\.shipped_at/, "new disputes must snapshot the source ship date");
assert.match(disputeStore, /Only negative Shipping label purchase adjustment rows are eligible/, "the server must enforce charge-only Temu imports");
assert.match(disputeStore, /references = \[\.\.\.referenceEvidence\.values\(\)\]/, "Temu order matching must be limited to accepted charge evidence");
assert.match(disputeStore, /importEvidence/, "Temu adjustment evidence must be retained on dispute items");
assert.match(disputeStore, /async function deleteAllBatches\(scope = \{\}\)/, "the dispute store must expose a scoped reset");
assert.match(disputeStore, /lock table shipping_dispute_batches in share row exclusive mode/, "the reset must serialize against concurrent dispute creation");
assert.match(disputeStore, /delete from shipping_dispute_batches where tenant_id=\$1 and company_id=\$2/, "the reset must remain tenant and company scoped");
assert.match(disputeStore, /pg_get_serial_sequence\('shipping_dispute_batches','batch_number'\)/, "an empty dispute workspace must restart its display numbering");
assert.match(server, /String\(body\.confirmation \|\| ""\) !== "DELETE ALL SHIPPING DISPUTES"/, "the destructive reset must require an explicit confirmation phrase");
assert.match(server, /!isSuperuserAccount\(authUser\)/, "only the superuser may reset every dispute");
assert.match(page, /Reset disputes/, "the superuser reset must be available from the Shipping Disputes workspace");

assert.equal(completePackage({ weight: 1, length: 2, width: 3, height: 4 }), true);
assert.equal(completePackage({ weight: 1, length: 2, width: 3, height: 0 }), false);
assert.equal(completeDestination({ line1: "1 Main St", city: "New York", state: "NY", postalCode: "10001", country: "US" }), true);
assert.equal(completeDestination({ city: "New York", state: "NY", postalCode: "10001", country: "US" }), false);
assert.equal(postalDestination({ postalCode: "10001", country: "US" }), true);
assert.equal(postalDestination({ country: "US" }), false);
assert.equal(destinationQuoteBasis({ line1: "1 Main St", city: "New York", state: "NY", postalCode: "10001", country: "US" }), "full_address");
assert.equal(destinationQuoteBasis({ postalCode: "10001", country: "US" }), "postal_code");
assert.equal(destinationQuoteBasis({ country: "US" }), "missing");
assert.equal(quoteEvidenceIsCurrent({
  latest_run_id: "run-old",
  latest_run_requested_at: "2026-10-26T12:00:00.000Z",
  raw: { catalogQuotePackage: { capturedAt: "2026-10-26T13:00:00.000Z" } },
}), false, "a quote made before catalog measurements changed must be treated as stale");
assert.equal(quoteEvidenceIsCurrent({
  latest_run_id: "run-current",
  latest_run_requested_at: "2026-10-26T14:00:00.000Z",
  raw: { catalogQuotePackage: { capturedAt: "2026-10-26T13:00:00.000Z" } },
}), true, "a quote made after catalog measurements changed must remain current");

assert.deepEqual(ups.upsAddress({ postalCode: "10001", country: "US" }), { PostalCode: "10001", CountryCode: "US" }, "UPS ZIP-only rating must omit empty street, city, and state fields");

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
], transactionType: "Shipping label purchase adjustment" }]).get("po-123");
assert.equal(adjustmentEvidence.signedAmount, -12.5, "only negative Temu shipping adjustments may be retained");
assert.equal(adjustmentEvidence.expenseAmount, 12.5, "accepted Temu charges must normalize to positive shipping expense");
assert.equal(adjustmentEvidence.chargeCount, 1, "credits must not count as dispute charges");
assert.equal(adjustmentEvidence.transactionCount, 1, "stored row counts must include accepted charges only");
assert.deepEqual(adjustmentEvidence.relatedIds, ["A"], "only accepted charge references may remain in dispute evidence");
assert.equal(normalizeReferenceEvidence([{ reference: "PO-456", transactionType: "Refund", transactions: [{ signedAmount: -8 }] }]).size, 0, "unrelated transaction types must be rejected server-side");
assert.equal(normalizeReferenceEvidence([{ reference: "PO-789", transactionType: "Shipping label purchase adjustment", transactions: [{ signedAmount: 8 }] }]).size, 0, "positive shipping adjustments must be rejected server-side");

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

const catalogPackage = catalogQuotePackage([{
  sku: "CHANNEL-1", catalogSku: "CATALOG-1", quantity: 1,
}], new Map([["catalog-1", {
  product_id: "product-1", sku: "CATALOG-1", raw: {
    itemLength: 6, itemWidth: 4, itemHeight: 2, itemWeight: 1,
    packageLength: 12, packageWidth: 8, packageHeight: 4, packageWeight: 12, uomQty: 12,
  },
}]]));
assert.equal(catalogPackage.parcel.source, "current_catalog_sku", "single-SKU quote packages must identify the catalog as their source");
assert.deepEqual(
  [catalogPackage.parcel.weight, catalogPackage.parcel.length, catalogPackage.parcel.width, catalogPackage.parcel.height],
  [1, 6, 4, 2],
  "shipping disputes must prefer individual sell-unit measurements over supplier case measurements"
);
const catalogMultiUnitPackage = catalogQuotePackage([{
  sku: "CHANNEL-1", catalogSku: "CATALOG-1", quantity: 2,
}], new Map([["catalog-1", {
  product_id: "product-1", sku: "CATALOG-1", raw: {
    itemLength: 6, itemWidth: 4, itemHeight: 2, itemWeight: 1,
    packageLength: 12, packageWidth: 8, packageHeight: 4, packageWeight: 12, uomQty: 12,
  },
}]]));
assert.equal(catalogMultiUnitPackage.parcel.source, "current_catalog_order_estimate", "multi-unit quote packages must be labeled as estimates");
assert.deepEqual(
  [catalogMultiUnitPackage.parcel.weight, catalogMultiUnitPackage.parcel.length, catalogMultiUnitPackage.parcel.width, catalogMultiUnitPackage.parcel.height],
  [2, 6, 4, 4],
  "multi-unit quote packages must combine individual sell-unit measurements"
);
const overriddenCatalogPackage = catalogQuotePackage([{
  sku: "CHANNEL-1", catalogSku: "CATALOG-1", quantity: 1,
}], new Map([["catalog-1", {
  product_id: "product-1", sku: "CATALOG-1", raw: {
    itemLength: 6, itemWidth: 4, itemHeight: 2, itemWeight: 1,
    packageLength: 12, packageWidth: 8, packageHeight: 4, packageWeight: 12,
    shippingPackageOverride: true,
  },
}]]));
assert.deepEqual(
  [overriddenCatalogPackage.parcel.weight, overriddenCatalogPackage.parcel.length, overriddenCatalogPackage.parcel.width, overriddenCatalogPackage.parcel.height],
  [12, 12, 8, 4],
  "an explicit catalog package override must remain authoritative"
);
assert.equal(sameQuotePackage(catalogPackage.parcel, { ...catalogPackage.parcel }), true, "unchanged catalog measurements must not rewrite dispute rows");
assert.equal(sameQuotePackage(catalogPackage.parcel, { ...catalogPackage.parcel, weight: 99 }), false, "changed catalog measurements must refresh dispute rows");
const trueValuePottingMixPackage = catalogQuotePackage([{
  sku: "BUS172083TRV", catalogSku: "BUS172083TRV", quantity: 3,
}], new Map([["bus172083trv", {
  product_id: "BUS172083TRV", sku: "BUS172083TRV", raw: {
    itemLength: 24, itemWidth: 11, itemHeight: 2, itemWeight: 15,
    packageLength: 48, packageWidth: 40, packageHeight: 57, packageWeight: 1980, uomQty: 120,
    shippingPackageOverride: false,
  },
}]]));
assert.deepEqual(
  [trueValuePottingMixPackage.parcel.weight, trueValuePottingMixPackage.parcel.length, trueValuePottingMixPackage.parcel.width, trueValuePottingMixPackage.parcel.height],
  [45, 24, 11, 6],
  "BUS172083TRV disputes must rate three individual units instead of three supplier cases"
);

const status = ups.publicStatus({ UPS_RATING_ENABLED: "true", UPS_CLIENT_ID: "id", UPS_CLIENT_SECRET: "secret", UPS_ACCOUNT_NUMBER: "ABC123" });
assert.equal(status.configured, true);
assert.equal(status.accountEnding, "C123");
assert.equal(Object.prototype.hasOwnProperty.call(status, "clientSecret"), false, "public UPS status must not expose credentials");

console.log("Shipping disputes checks passed.");
