const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");

const detailStart = server.indexOf('parts[1] === "purchase-orders" && parts[2] && parts.length === 3');
const detailEnd = server.indexOf('parts[3] === "lines"', detailStart);
assert.ok(detailStart >= 0 && detailEnd > detailStart, "purchase-order detail route must exist");
const detailRoute = server.slice(detailStart, detailEnd);

assert.doesNotMatch(detailRoute, /readDbFast\(/, "one PO must not load broad application state");
assert.match(detailRoute, /readStateFields\(\["vendors", "warehouses", "systemSettings", "fulfillmentOperationsSettings"\]/, "one PO should read only required state fields");
assert.match(server, /\/api\/purchase-orders\/reference-data/, "PO editor must use narrow reference data");
assert.doesNotMatch(app.slice(app.indexOf("function PurchaseOrderDetailPage"), app.indexOf("function PurchaseOrderDetailPage") + 9000), /\/api\/state\?lite=1/, "PO detail must not eagerly load the broad lite state");
assert.match(app, /function PurchaseOrderProgress/, "PO detail must expose workflow progress");
assert.match(app, /grid w-full min-w-0 max-w-full gap-5 overflow-hidden/, "PO detail must contain wide content");
assert.match(server, /function markPurchaseOrderInbound/, "POs must support an audited inbound action without tracking");
assert.match(server, /supplierInboundTrackingExpected/, "supplier profiles must control whether inbound tracking is expected");
assert.match(server, /mark_inbound/, "the PO action route must accept mark inbound");
assert.match(app, /Supplier provides inbound tracking/, "vendor profiles must expose the inbound tracking rule");
assert.match(app, /> Mark inbound</, "placed PO details must expose the inbound action");
assert.match(app, /<DropdownMenuLabel>Supplier and shipping<\/DropdownMenuLabel>/, "PO actions must be grouped for scanning");
assert.match(app, /<DropdownMenuLabel>Fulfillment<\/DropdownMenuLabel>/, "PO fulfillment actions must have their own group");
assert.match(app, /purchaseOrderCtechNumber\(po\)/, "a CTech PO number must count as supplier submission evidence in the UI");
assert.match(server, /if \(po\.ctechId \|\| po\.ctech_id\) return true;/, "a CTech PO number must always count as supplier submission evidence on the server");
assert.match(server, /The CTech reference confirms buyer approval and supplier submission\./, "saving a CTech PO number must audit its approval and submission meaning");

console.log("Purchase-order detail efficiency checks passed.");
