const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "..", "web", "src", "App.tsx"), "utf8");
const start = app.indexOf('<Dialog open={Boolean(printJobPreview)}');
const end = app.indexOf('<Dialog open={Boolean(packageRow)}', start);
assert.ok(start >= 0 && end > start, "purchased-label dialog must remain discoverable");
const dialog = app.slice(start, end);

assert.match(dialog, /printPacketPreviewOpen \? <div/, "the PDF preview must be opt-in");
assert.match(app, /batchId: row\.fulfillmentBatchId, batchNumber: row\.fulfillmentBatchNumber, orderCount: 1/, "row-level label printing must retain its batch metadata");
assert.match(dialog, /setPrintPacketPreviewOpen\(next\)/, "the dialog must expose a preview toggle");
assert.match(dialog, />Label only</, "the compact document selector must retain label-only printing");
assert.match(dialog, />Label \+ 4 × 6 slip</, "the compact document selector must retain thermal packing slips");
assert.match(dialog, />Label \+ Letter slip</, "the compact document selector must retain Letter packing slips");
assert.match(dialog, /previewPrintDestination === "browser" \? "Print" : "Send to printer"/, "the primary browser action must be named Print");
assert.doesNotMatch(dialog, /Print in browser/, "the compact dialog must not use the old verbose action label");

const printStart = app.indexOf("const printInBrowser = async () =>", app.indexOf("function Fulfillment"));
const printEnd = app.indexOf("const recordBatchPdfSave", printStart);
assert.ok(printStart >= 0 && printEnd > printStart, "fulfillment browser print handler must remain discoverable");
const printHandler = app.slice(printStart, printEnd);
assert.match(printHandler, /document\.createElement\("iframe"\)/, "direct printing must lazily create a packet frame");
assert.match(printHandler, /frame\.contentWindow\?\.print\(\)/, "the temporary frame must open the browser print dialog");
assert.match(printHandler, /frame\.remove\(\)/, "the temporary print frame must be cleaned up");
assert.match(printHandler, /\/printed`/, "browser printing must retain durable print and channel activity recording");

console.log("PASS fulfillment label dialog stays compact and lazy-loads packet previews");
