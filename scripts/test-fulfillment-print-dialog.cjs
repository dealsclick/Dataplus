const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = ["App.tsx", "components/fulfillment-route.tsx"].map((file) => fs.readFileSync(path.join(__dirname, "..", "web", "src", ...file.split("/")), "utf8")).join("\n");
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
assert.match(dialog, /min-h-16 shrink-0 border-t/, "the footer must reserve enough height for its controls");
assert.match(dialog, /grid w-full grid-cols-2 gap-2 sm:flex/, "the footer actions must use a stable two-column mobile layout");
assert.match(dialog, /border-primary\/50 bg-primary\/10/, "the selected print destination must have prominent visual treatment");
assert.match(dialog, /border-amber-500\/60/, "an open warehouse batch must have prominent visual treatment");

const shipmentStart = app.indexOf("function FulfillmentShipmentTable");
const shipmentEnd = app.indexOf("const fulfillmentWorkColumnOptions", shipmentStart);
assert.ok(shipmentStart >= 0 && shipmentEnd > shipmentStart, "purchased-label shipment table must remain discoverable");
const shipmentTable = app.slice(shipmentStart, shipmentEnd);
assert.match(shipmentTable, />Carrier \/ service \/ source</, "shipment metadata must identify carrier, service, and label source");
assert.match(shipmentTable, />Marketplace status</, "channel acknowledgement must use a clear marketplace-status heading");
assert.match(shipmentTable, /<MoreHorizontal className="size-4"/, "row printing and pick sheets must live in the actions menu");
assert.match(shipmentTable, /sticky right-0 z-20 w-12/, "the actions header must remain pinned to the table's right edge");
assert.match(shipmentTable, /sticky right-0 z-10 bg-background text-right/, "each row action must remain pinned during horizontal scrolling");
assert.match(shipmentTable, /> Pick sheet</, "the row actions menu must retain pick-sheet access");
assert.match(shipmentTable, /printed \? "Reprint label" : "Print label"/, "the row actions menu must retain label printing");
assert.doesNotMatch(shipmentTable, /<TableHead>Picking<\/TableHead>/, "the old wide picking column must stay removed");
assert.doesNotMatch(shipmentTable, /<TableHead>Label<\/TableHead>/, "the old wide label-action column must stay removed");

const printStart = app.indexOf("const printInBrowser = async () =>", app.indexOf("function Fulfillment"));
const printEnd = app.indexOf("const recordBatchPdfSave", printStart);
assert.ok(printStart >= 0 && printEnd > printStart, "fulfillment browser print handler must remain discoverable");
const printHandler = app.slice(printStart, printEnd);
assert.match(printHandler, /document\.createElement\("iframe"\)/, "direct printing must lazily create a packet frame");
assert.match(printHandler, /frame\.contentWindow\?\.print\(\)/, "the temporary frame must open the browser print dialog");
assert.match(printHandler, /frame\.remove\(\)/, "the temporary print frame must be cleaned up");
assert.match(printHandler, /\/printed`/, "browser printing must retain durable print and channel activity recording");

console.log("PASS fulfillment label dialog stays compact and lazy-loads packet previews");
