const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require(path.resolve(__dirname, "..", "web", "node_modules", "typescript"));

const root = path.resolve(__dirname, "..");
const ui = fs.readFileSync(path.join(root, "web", "src", "components", "warehouse-route.tsx"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

function functionSource(name) {
  const start = ui.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const bodyStart = ui.indexOf(") {", start) + 2;
  let depth = 0;
  for (let index = bodyStart; index < ui.length; index += 1) {
    if (ui[index] === "{") depth += 1;
    if (ui[index] === "}") depth -= 1;
    if (depth === 0) return ui.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

const context = {};
vm.createContext(context);
const transpiled = ts.transpileModule(functionSource("warehouseReceivingStatus"), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInContext(transpiled, context);

assert.equal(context.warehouseReceivingStatus({ receivingPoLine: { expectedQty: 60 }, countedQty: 60 }), "complete");
assert.equal(context.warehouseReceivingStatus({ receivingPoLine: { expectedQty: 69 }, countedQty: 60 }), "partial");
assert.equal(context.warehouseReceivingStatus({ receivingPoLine: { expectedQty: 20 }, countedQty: 0 }), "awaiting_scan");
assert.equal(context.warehouseReceivingStatus({ countedQty: 4 }), "extra");

assert.match(ui, /Find SKU, UPC, MPN, vendor SKU, or title/, "audit items can be searched by warehouse identifiers");
assert.match(ui, /Filter by receiving status/, "audit items expose a receiving-status filter");
assert.match(ui, /Awaiting scan/, "zero-count expected lines use an operational label instead of not counted");
assert.match(ui, /!catalogBarcode && auditStatus === "in_progress"[\s\S]*Add UPC/, "Add UPC is shown only when the catalog barcode is missing");
assert.match(ui, /\/lines\/\$\{encodeURIComponent\(auditLineKey\(upcLine\)\)\}\/upc/, "the UPC dialog saves through the guarded audit endpoint");

assert.match(server, /parts\[5\] === "upc"/, "the audit UPC route exists");
assert.match(server, /already has UPC[\s\S]*Open the catalog product to review it/, "the server refuses to replace an existing catalog UPC");
assert.match(server, /findBarcodeMatches\(barcodeLookupForms\(upc\)\)/, "the server checks the UPC against the managed catalog");
assert.doesNotMatch(server, /already belongs to catalog SKU[\s\S]*The UPC was not changed/, "a UPC already used by another supplier SKU is not blocked");
assert.match(server, /sharedWithSkus/, "shared UPC relationships are recorded for review");
assert.match(server, /type: "upc_added_from_receiving"/, "catalog identifier history records warehouse UPC additions");
assert.match(server, /type: "catalog_upc_added"/, "the warehouse audit lifecycle records the UPC addition");
assert.match(ui, /supplier-specific SKUs may share the same physical UPC/, "the audit explains shared supplier UPC behavior");

console.log("Warehouse audit item filters and supplier-aware missing-UPC updates are covered.");
