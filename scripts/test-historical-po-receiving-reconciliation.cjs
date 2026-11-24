const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  allocateAuditLines,
  descriptor,
  lineOpenQuantity,
  matchExpectedLine,
} = require("../lib/historical-po-receiving");

const expected = [
  descriptor({ id: "line-a", lineIndex: 0, sku: "BUS210787TRV", upc: "045242167234", vendorItemNumber: "48-89-2801", manufacturerSku: "48-89-2801", title: "Thunderbolt Black Oxide Drill Bit Set", expectedQty: 20 }),
  descriptor({ id: "line-b", lineIndex: 1, sku: "BUS142523TRV", upc: "045242749416", vendorItemNumber: "48-89-4670", manufacturerSku: "48-89-4670", title: "Shockwave Impact Duty Red Helix Drill Bit Set", expectedQty: 20 }),
];

assert.doesNotThrow(() => descriptor({ sku: "SKU-WITHOUT-CATALOG-PRODUCT" }, null), "missing catalog products remain valid shipment evidence inputs");

let result = matchExpectedLine(descriptor({ sku: "BUS210787TRV", countedQty: 20 }), expected);
assert.equal(result.match?.basis, "sku_or_alias");
assert.equal(result.match?.reviewRequired, false);

result = matchExpectedLine(descriptor({ sku: "DPS-OLD", barcode: "45242749416", countedQty: 20 }), expected);
assert.equal(result.match?.candidate.record.id, "line-b", "leading-zero UPCs identify the ordered line");
assert.equal(result.match?.basis, "upc_gtin");

result = matchExpectedLine(descriptor({ sku: "DPS-OLD", selectedVendorSku: "48 89 2801", countedQty: 20 }), expected);
assert.equal(result.match?.candidate.record.id, "line-a", "supplier SKU punctuation does not create a false extra");
assert.equal(result.match?.basis, "supplier_sku");

result = matchExpectedLine(descriptor({ sku: "DPS-OLD", manufacturerSku: "48894670", title: "Shockwave Impact Duty Red Helix Drill Bit Set", countedQty: 20 }), expected);
assert.equal(result.match?.candidate.record.id, "line-b");
assert.equal(result.match?.basis, "normalized_mpn");
assert.equal(result.match?.reviewRequired, true, "MPN-only historical links remain reviewable");

result = matchExpectedLine(descriptor({ sku: "DPS-OLD", manufacturerSku: "48-89-4671", title: "Shockwave Impact Duty Red Helix Drill Bit Set", countedQty: 20 }), expected);
assert.equal(result.match?.candidate.record.id, "line-b");
assert.equal(result.match?.basis, "near_mpn");
assert.equal(result.match?.reviewRequired, true, "one-character MPN repairs require review");

const allocation = allocateAuditLines([
  descriptor({ id: "scan-a", sku: "BUS210787TRV", countedQty: 20 }),
  descriptor({ id: "scan-extra", sku: "DPS-EXTRA", barcode: "999999999999", countedQty: 3 }),
], expected);
assert.equal(allocation.allocations.length, 1);
assert.equal(allocation.allocations[0].purchaseUnits, 20);
assert.equal(allocation.extras.length, 1, "genuine unmatched inventory is retained as extra review evidence");
assert.equal(allocation.extras[0].reason, "no_ordered_line_match");

const over = allocateAuditLines([descriptor({ id: "scan-over", sku: "BUS210787TRV", countedQty: 22 })], expected);
assert.equal(over.allocations[0].purchaseUnits, 20);
assert.equal(over.extras[0].countedQty, 2, "overage does not prevent the ordered quantity from being satisfied");

assert.equal(lineOpenQuantity({ qty: 20, receivedQty: 8, shortClosedQty: 2, canceledQty: 1 }), 9);

const root = path.resolve(__dirname, "..");
const repair = fs.readFileSync(path.join(root, "scripts", "reconcile-historical-po-receiving.cjs"), "utf8");
const ui = fs.readFileSync(path.join(root, "web", "src", "components", "purchasing-workspaces.tsx"), "utf8");
assert.match(repair, /--confirm-no-inventory-change/, "apply mode has an explicit no-inventory-change guard");
assert.match(repair, /physicalInventoryChanged:\s*false/, "the repair records its inventory-neutral behavior");
assert.doesNotMatch(repair, /addInventoryLedger|upsertInventoryLevelsFromProducts|quantityChange/, "the historical repair cannot post or deduct stock");
assert.match(repair, /outbound_audit_scans/, "outbound shipment evidence is inspected");
assert.match(repair, /unsupported\.length \? "left_open_missing_receiving_evidence" : "close"/, "unsupported ordered lines remain open");
assert.match(ui, /Closed with historical receiving review/, "PO detail exposes the review flag");

console.log("Historical PO receiving reconciliation ranks identifiers, preserves extras for review, and never changes physical inventory.");
