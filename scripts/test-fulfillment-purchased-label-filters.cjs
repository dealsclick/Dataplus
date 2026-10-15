const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "web", "src", "App.tsx"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const tabStart = app.indexOf('<TabsContent value="purchased-labels"');
const tabEnd = app.indexOf('<TabsContent value="shipments"', tabStart);
assert.ok(tabStart >= 0 && tabEnd > tabStart, "the Purchased labels tab must remain discoverable");
const purchasedLabels = app.slice(tabStart, tabEnd);

for (const label of ["Print status", "Carrier", "Supplier", "SKU breakdown", "Channel", "Label source", "Channel update"]) {
  assert.match(purchasedLabels, new RegExp(label), `Purchased labels must retain the ${label} filter`);
}
assert.match(purchasedLabels, /Showing \{numberLabel\(displayedPurchasedLabels\.length\)\} of/, "the filter bar must show its result count");
assert.match(purchasedLabels, /clearPurchasedLabelFilters/, "the filter bar must provide a single reset action");
assert.match(app, /Number\(row\.labelPrintCount \|\| 0\) > 0 \|\| Boolean\(row\.labelPrintedAt\)/, "print filtering must honor durable print counts");

assert.match(server, /const shipmentSupplierNames = \(order, shipmentLines = \[\]\) =>/, "the fulfillment snapshot must resolve shipment suppliers");
assert.match(server, /supplierNames,\s*\n\s*supplierName: supplierNames\.join\(", "\)/, "shipment rows must expose supplier names to the filter bar");
assert.match(server, /FULFILLMENT_CONSOLE_SNAPSHOT_VERSION = 3/, "the supplier projection must invalidate older stored snapshots");

console.log("PASS Purchased labels exposes counted local filters and supplier provenance");
