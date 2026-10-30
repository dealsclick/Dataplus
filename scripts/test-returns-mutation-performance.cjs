const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8").replace(/\r\n/g, "\n");
const database = fs.readFileSync(path.join(root, "db.js"), "utf8").replace(/\r\n/g, "\n");
const workspace = fs.readFileSync(path.join(root, "web", "src", "components", "returns-workspace.tsx"), "utf8").replace(/\r\n/g, "\n");

const shippingStart = server.indexOf('parts[1] === "returns" && parts[2] && parts[3] === "pdf"');
const shippingEnd = server.indexOf('parts[1] === "orders" && parts[2] && parts[3] === "payments"', shippingStart);
const shippingRoutes = server.slice(shippingStart, shippingEnd);
assert.ok(shippingStart >= 0 && shippingEnd > shippingStart, "return document and shipping routes must exist");
assert.doesNotMatch(shippingRoutes, /readDbFast\(/, "return label, refund, tracking, email, and sync routes must not hydrate global relational state");
assert.match(shippingRoutes, /readStateFields\(\["connections", "systemSettings", "warehouses"\]/, "return-label rates should load only required reference documents");
assert.ok((shippingRoutes.match(/acquireReturnWriteLock\(parts\[2\]\)/g) || []).length >= 8, "each return mutation should use a per-return write lock");

const editStart = server.indexOf('req.method === "PATCH" && parts[0] === "api" && parts[1] === "returns"');
const editEnd = server.indexOf('\n  if (req.method === "GET" && parts[0] === "api" && parts[1] === "warehouses"', editStart);
const editRoute = server.slice(editStart, editEnd);
assert.ok(editStart >= 0 && editEnd > editStart, "return edit route must exist");
assert.match(editRoute, /acquireReturnWriteLock\(parts\[2\]\)/, "return edits should serialize only the selected RMA");
assert.match(editRoute, /body\.expectedUpdatedAt/, "return edits should reject stale receiving and detail forms");
assert.match(editRoute, /readStateFields\(\["systemSettings", "warehouses"\]/, "return edits should load only required reference documents");
assert.match(editRoute, /purchaseOrdersForReturn\(record\)/, "return edits should load purchase orders only for returned SKUs");
assert.match(editRoute, /prependInventoryLedgerEvents\(db\.inventoryLedger/, "return receiving should append new ledger events atomically");
assert.doesNotMatch(editRoute, /readStateField\("inventoryLedger"\)/, "return receiving must not read and rewrite the complete inventory ledger");
assert.doesNotMatch(editRoute, /readDbFast\(/, "return edits must not hydrate global relational state");
assert.doesNotMatch(editRoute, /publicState\(/, "return edits must not return the application shell state");

const lockStart = database.indexOf("async function acquireReturnWriteLock(");
const lockEnd = database.indexOf("\nasync function readImportedReturn", lockStart);
const lockHelper = database.slice(lockStart, lockEnd);
assert.match(lockHelper, /dataplus-return:\$\{resolved\.rows\[0\]\?\.entity_id/, "return locks should resolve aliases to the canonical return ID");
assert.doesNotMatch(workspace, /await onUpdated\(\)/, "paginated Returns mutations should not reload Orders references or global state");
assert.match(workspace, /setReloadToken\(\(current\) => current \+ 1\)/, "paginated Returns mutations should refresh only the Returns workspace endpoint");

console.log("Returns mutation performance safeguards passed.");
