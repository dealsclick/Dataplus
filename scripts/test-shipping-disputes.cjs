const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const database = fs.readFileSync(path.join(root, "db.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "scripts", "dataplus-worker.js"), "utf8");
const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");
const page = fs.readFileSync(path.join(root, "web", "src", "components", "shipping-disputes.tsx"), "utf8");
const { completePackage, completeDestination, selectLowestRates } = require("../lib/shipping-disputes");
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
assert.doesNotMatch(disputeStore, /from unnest\([^)]*\)[\s\S]{0,160}left join lateral/, "bulk dispute matching must not rescan orders once per reference");
assert.match(worker, /shipping-dispute-quotes/, "the external worker must support dispute quote jobs");
assert.match(app, /shipping-disputes/, "the React router must expose Shipping Disputes");
assert.match(page, /Quotes are evidence only and never alter orders, labels, or settlements/, "the UI must explain the non-mutating workflow");
assert.match(page, /await import\("xlsx"\)/, "Excel parsing must remain outside the default Shipping Disputes bundle");
assert.match(page, /\.csv,\.txt,\.xlsx,\.xls/, "the dispute uploader must accept CSV, text, and Excel workbooks");
assert.match(page, /CSV, TXT, XLSX, and XLS files/, "the dispute dialog must disclose every supported upload format");
assert.match(page, /file\.size > 10 \* 1024 \* 1024/, "browser uploads must have a bounded workbook size");

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

const status = ups.publicStatus({ UPS_RATING_ENABLED: "true", UPS_CLIENT_ID: "id", UPS_CLIENT_SECRET: "secret", UPS_ACCOUNT_NUMBER: "ABC123" });
assert.equal(status.configured, true);
assert.equal(status.accountEnding, "C123");
assert.equal(Object.prototype.hasOwnProperty.call(status, "clientSecret"), false, "public UPS status must not expose credentials");

console.log("Shipping disputes checks passed.");
