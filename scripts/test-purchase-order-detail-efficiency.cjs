const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const database = fs.readFileSync(path.join(root, "db.js"), "utf8");
const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");

const headerSaveStart = database.indexOf("async function savePurchaseOrderHeader");
const headerSaveEnd = database.indexOf("function clearOrderPurchaseOrderLinks", headerSaveStart);
assert.ok(headerSaveStart >= 0 && headerSaveEnd > headerSaveStart, "header-only purchase-order persistence must exist");
const headerSave = database.slice(headerSaveStart, headerSaveEnd);
assert.match(headerSave, /update purchase_order_records set/, "header-only PO saves must update the PO record");
assert.doesNotMatch(headerSave, /delete from purchase_order_line_items|insert into purchase_order_line_items/, "header-only PO saves must preserve relational line rows");
assert.match(headerSave, /record\.raw\.items = existing\.raw\.items/, "header-only PO saves must preserve the latest raw line snapshot");
assert.doesNotMatch(headerSave, /total_units =|received_units =|estimated_cost =/, "header-only PO saves must preserve relational line aggregates");

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
assert.match(editRoute, /if \(body\.vendorId !== undefined\) referenceFields\.push\("vendors"\)/, "PO edits should load vendor references only when the vendor changes");
assert.match(editRoute, /if \(body\.warehouseId !== undefined\) referenceFields\.push\("warehouses"\)/, "PO edits should load warehouse references only when the warehouse changes");
assert.doesNotMatch(editRoute, /withOperationalSummary|publicState\(/, "PO edits must not rebuild or return global operational state");
assert.match(editRoute, /authUser\?\.name \|\| authUser\?\.username \|\| authUser\?\.email/, "PO edits must use the authenticated actor");
assert.match(editRoute, /if \(Array\.isArray\(body\.items\)\) await postgres\.savePurchaseOrder\(po\);[\s\S]*?else await postgres\.savePurchaseOrderHeader\(po\);/, "PO edits must rewrite lines only when line quantities were submitted");

const actionStart = server.indexOf('parts[1] === "purchase-orders" && parts[2] && parts[3] === "action" && postgres.isPostgresEnabled()');
const actionEnd = server.indexOf('parts[2] === "external-preview"', actionStart);
assert.ok(actionStart >= 0 && actionEnd > actionStart, "PostgreSQL purchase-order action route must exist");
const actionRoute = server.slice(actionStart, actionEnd);
assert.doesNotMatch(actionRoute, /withOperationalSummary|readDbFast\(|publicState\(/, "PO actions must not rebuild or return global operational state");
assert.match(actionRoute, /authUser\?\.name \|\| authUser\?\.username \|\| authUser\?\.email/, "PO actions must use the authenticated actor");
assert.match(actionRoute, /savePurchaseOrderHeader\(po/, "metadata-only PO actions must preserve relational line rows");
assert.match(actionRoute, /savePurchaseOrder\(po, \{ allowStatusRegression: true \}\)/, "line cancellation and routing actions must retain full PO persistence");

const submitStart = server.indexOf('parts[3] === "submit" && postgres.isPostgresEnabled()');
const submitEnd = server.indexOf('parts[3] === "receipt-correction"', submitStart);
assert.ok(submitStart >= 0 && submitEnd > submitStart, "PostgreSQL purchase-order submit route must exist");
const submitRoute = server.slice(submitStart, submitEnd);
assert.doesNotMatch(submitRoute, /withOperationalSummary|readDbFast\(|publicState\(/, "PO submission must not rebuild or return global operational state");
assert.match(submitRoute, /savePurchaseOrderHeader\(po\)/, "PO submission must not rewrite unchanged line rows");

const documentStart = server.indexOf('parts[1] === "purchase-orders" && parts[2] && parts[3] === "documents" && postgres.isPostgresEnabled()');
const documentEnd = server.indexOf('req.method === "PATCH"', documentStart);
assert.ok(documentStart >= 0 && documentEnd > documentStart, "PostgreSQL purchase-order document route must exist");
const documentRoute = server.slice(documentStart, documentEnd);
assert.doesNotMatch(documentRoute, /const linkedOrders|action === "approve"/, "linking a PO document must not rewrite unrelated order routes");
assert.match(documentRoute, /savePurchaseOrderHeader\(po\)/, "linking a PO document must preserve relational line rows");

const lineCostStart = server.indexOf('parts[3] === "lines" && parts[4] === "cost" && postgres.isPostgresEnabled()');
const lineCostEnd = server.indexOf('parts[3] === "reminder"', lineCostStart);
assert.ok(lineCostStart >= 0 && lineCostEnd > lineCostStart, "PO line-cost route must exist");
assert.match(server.slice(lineCostStart, lineCostEnd), /savePurchaseOrder\(po\)/, "line-cost updates must retain full PO persistence");

const receiveStart = server.indexOf('parts[3] === "receive" && postgres.isPostgresEnabled()');
const receiveEnd = server.indexOf('parts[3] === "returns"', receiveStart);
assert.ok(receiveStart >= 0 && receiveEnd > receiveStart, "PO receiving route must exist");
assert.match(server.slice(receiveStart, receiveEnd), /savePurchaseOrder\(po\)/, "receiving must retain full PO persistence");

const poDetailStart = app.indexOf("function PurchaseOrderDetailPage");
const poDetailPage = app.slice(poDetailStart, poDetailStart + 50000);
assert.doesNotMatch(poDetailPage, /user: "Luis"/, "PO detail actions must not hard-code an operator");
assert.match(poDetailPage, /setData\(\(current\) => \(\{ \.\.\.current, purchaseOrder: result\.purchaseOrder \}\)\)/, "PO edits should apply the returned PO without a duplicate reload");
assert.match(poDetailPage, /const saveAcknowledgement = async[\s\S]*?setAcknowledgementOpen\(false\); void load\(\)/, "reference saves should release the UI before quiet reconciliation");
assert.match(poDetailPage, /const saveInboundTracking = async[\s\S]*?setInboundTrackingOpen\(false\); void load\(\)/, "inbound tracking saves should release the UI before quiet reconciliation");
assert.match(poDetailPage, /const submit = async[\s\S]*?void load\(\)/, "PO submission should release the UI before quiet reconciliation");
assert.match(poDetailPage, /const saveDocument = async[\s\S]*?setDocumentOpen\(false\); void load\(\)/, "document saves should release the UI before quiet reconciliation");
assert.match(app, /<PurchaseOrderDetailPage operatorName=\{authUser\.name \|\| authUser\.username \|\| "Buyer"\}/, "desktop PO details must receive the signed-in operator");

console.log("Purchase-order detail efficiency checks passed.");
