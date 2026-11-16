const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizedWarehouseAuditLookupNumbers } = require("../db");

assert.deepEqual(normalizedWarehouseAuditLookupNumbers("AUDIT-221"), ["a-221", "audit-221"]);
assert.deepEqual(normalizedWarehouseAuditLookupNumbers("A-221"), ["a-221", "audit-221"]);
assert.deepEqual(normalizedWarehouseAuditLookupNumbers("221"), ["a-221", "audit-221"]);
assert.deepEqual(normalizedWarehouseAuditLookupNumbers("2e982a86-e6b6-4547-9166-9173a1360e18"), []);

const root = path.resolve(__dirname, "..");
const db = fs.readFileSync(path.join(root, "db.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const helper = fs.readFileSync(path.join(root, "web", "src", "lib", "warehouse-audit-url.ts"), "utf8");
const warehouse = fs.readFileSync(path.join(root, "web", "src", "components", "warehouse-route.tsx"), "utf8");
const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");

assert.match(helper, /return `A-\$\{auditSequence\[1\]\}`/, "audit URLs use the short A-number reference");
assert.match(helper, /warehouseAuditMatchesKey/, "old UUIDs and short references share one route matcher");
assert.match(db, /normalizedWarehouseAuditLookupNumbers\(normalizedAuditId\)/, "audit detail lookup accepts canonical aliases");
assert.match(db, /from warehouse_audits a[\s\S]*auditStartsWith/, "quick operations search includes warehouse audits");
assert.match(warehouse, /window\.history\.replaceState\(window\.history\.state, "", `\$\{canonicalPath\}/, "old audit bookmarks rewrite to the canonical URL");
assert.match(warehouse, /warehouseAuditUrl\(audit\.auditNumber, audit\.id, mobile\)/, "audit-register links use readable references");
assert.match(server, /type: "audit"[\s\S]*href: `\/warehouse\/audits\//, "quick-find audit results open canonical URLs");
assert.match(app, /type: "order" \| "purchase-order" \| "audit"/, "quick find accepts audit results");
assert.match(app, /Quick find SKU, order, PO, or audit/, "quick find tells operators audit search is available");

console.log("PASS warehouse audit URL normalization and quick search");
