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

const editStart = server.indexOf('req.method === "PATCH" && parts[0] === "api" && parts[1] === "purchase-orders" && parts[2]');
const editEnd = server.indexOf('parts[3] === "financials"', editStart);
assert.ok(editStart >= 0 && editEnd > editStart, "purchase-order edit route must exist");
const editRoute = server.slice(editStart, editEnd);
assert.match(editRoute, /referenceFields = \[\.\.\.new Set/, "PO edits should determine the reference data required by the submitted fields");
assert.match(editRoute, /X-DataPlus-PO-Save-Ms/, "PO edits should expose save timing for production diagnostics");
assert.doesNotMatch(editRoute, /withOperationalSummary|publicState\(/, "PO edits must not rebuild or return global operational state");
assert.match(editRoute, /authUser\?\.name \|\| authUser\?\.username \|\| authUser\?\.email/, "PO edits must use the authenticated actor");

const poDetailStart = app.indexOf("function PurchaseOrderDetailPage");
const poDetailPage = app.slice(poDetailStart, poDetailStart + 50000);
assert.doesNotMatch(poDetailPage, /user: "Luis"/, "PO detail actions must not hard-code an operator");
assert.match(poDetailPage, /setData\(\(current\) => \(\{ \.\.\.current, purchaseOrder: result\.purchaseOrder \}\)\)/, "PO edits should apply the returned PO without a duplicate reload");
assert.match(app, /<PurchaseOrderDetailPage operatorName=\{authUser\.name \|\| authUser\.username \|\| "Buyer"\}/, "desktop PO details must receive the signed-in operator");

const resourceStart = server.indexOf('parts[3] === "re-source-options"');
const resourceEnd = server.indexOf('url.pathname === "/api/purchase-orders/reference-data"', resourceStart);
assert.ok(resourceStart >= 0 && resourceEnd > resourceStart, "PO re-source and dropship routes must exist");
const mutationRoutes = server.slice(resourceStart, resourceEnd);
assert.doesNotMatch(mutationRoutes, /listPurchaseOrders\(\{ limit: 5000 \}\)/, "interactive PO mutations must not hydrate 5,000 purchase orders");
assert.match(mutationRoutes, /readPurchaseOrderMutationContext/, "re-source and dropship actions should use bounded supplier context");
assert.match(mutationRoutes, /readPurchaseOrdersByIds\(selectedIds\)/, "dropship consolidation should load only selected POs");

assert.match(server, /findPurchaseOrderByExternalReference\(vendor\.id, document\.poNumber\)/, "external PO duplicate checks should use indexed SQL");
const reminderStart = server.indexOf('parts[2] === "reminders" && parts[3] === "run"');
const reminderEnd = server.indexOf('parts[3] === "documents"', reminderStart);
assert.ok(reminderStart >= 0 && reminderEnd > reminderStart, "overdue reminder route must exist");
const reminderRoute = server.slice(reminderStart, reminderEnd);
assert.match(reminderRoute, /const pageSize = 250;/, "overdue reminder scans should declare a bounded page size");
assert.match(reminderRoute, /limit: pageSize, offset/, "overdue reminder scans should read one page at a time");
assert.doesNotMatch(reminderRoute, /limit: 5000/, "overdue reminder scans must not hydrate 5,000 POs");
assert.match(server, /eligiblePurchaseRequirementsForPool[\s\S]*readOrdersByIds\(orderIds\)/, "purchase pooling should load only orders for eligible requirements");
const scheduledPoolStart = server.indexOf("async function processScheduledPurchasePooling");
const scheduledPoolEnd = server.indexOf("function sanitizeSmtpRelayMessage", scheduledPoolStart);
assert.ok(scheduledPoolStart >= 0 && scheduledPoolEnd > scheduledPoolStart, "scheduled PO pooling must exist");
const scheduledPool = server.slice(scheduledPoolStart, scheduledPoolEnd);
assert.doesNotMatch(scheduledPool, /limit: 5000/, "scheduled PO pooling must not hydrate 5,000 POs");
assert.match(scheduledPool, /cutoffPurchaseOrders[\s\S]*limit: 500/, "scheduled cutoff transitions should run in a bounded page");

console.log("Purchase-order detail efficiency checks passed.");
