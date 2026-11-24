const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require(path.resolve(__dirname, "..", "web", "node_modules", "typescript"));

const ui = fs.readFileSync(path.resolve(__dirname, "..", "web", "src", "components", "warehouse-route.tsx"), "utf8");

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

const context = { Map, Set };
vm.createContext(context);
const helpers = [
  functionSource("receivingIdentifierKeys"),
  functionSource("receivingLineMatch"),
  functionSource("receivingContributorAllocator"),
  functionSource("buildLinkedPurchaseOrderReceiptItems"),
  functionSource("linkedPurchaseOrderReceiptCompletion"),
].join("\n");
const transpiledHelpers = ts.transpileModule(helpers, {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInContext(transpiledHelpers, context);

const expectedLines = [
  { id: "line-a", lineIndex: 0, sku: "SKU-A", expectedQty: 2, inventoryMultiplier: 1 },
  { id: "line-b", lineIndex: 1, sku: "SKU-B", expectedQty: 3, inventoryMultiplier: 1 },
];
const audit = {
  id: "audit-1",
  reason: "purchase_order_receipt",
  linkedPurchaseOrderId: "po-1",
  purchaseOrderExpectedLines: expectedLines,
  lines: [
    { id: "scan-a", sku: "SKU-A", countedQty: 2 },
    { id: "scan-b", sku: "SKU-B", countedQty: 3 },
  ],
  unknownBarcodes: [],
};

const complete = context.linkedPurchaseOrderReceiptCompletion(audit);
assert.equal(complete.complete, true, "a fully counted PO receipt is complete");
assert.equal(complete.expectedUnits, 5);
assert.equal(complete.matchedUnits, 5);
assert.equal(complete.remainingUnits, 0);

const short = context.linkedPurchaseOrderReceiptCompletion({
  ...audit,
  lines: [audit.lines[0], { ...audit.lines[1], countedQty: 2 }],
});
assert.equal(short.complete, false, "a short PO line does not open the completion prompt");
assert.equal(short.remainingUnits, 1);

const unresolved = context.linkedPurchaseOrderReceiptCompletion({
  ...audit,
  unknownBarcodes: [{ barcode: "UNKNOWN", count: 1 }],
});
assert.equal(unresolved.complete, false, "unresolved scans must be handled before the prompt opens");

assert.match(ui, /Receiving complete/, "the automatic dialog clearly announces completion");
assert.match(ui, /Post inventory/, "the automatic dialog offers inventory posting");
assert.match(ui, /Go back and edit/, "the automatic dialog lets the receiver revise counts");
assert.match(ui, /autoCompletionPromptedRef/, "dismissing a completed count does not immediately reopen the dialog");

console.log("PO receiving automatically prompts once all expected units are counted and resolved.");
