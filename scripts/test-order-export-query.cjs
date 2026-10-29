const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dbSource = fs.readFileSync(path.join(root, "db.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");

for (const field of ["line_vendor_sku", "line_mfr_part_number", "line_upc"]) {
  assert.match(dbSource, new RegExp(`as ${field}\\b`), `order summaries must project ${field}`);
}

assert.match(dbSource, /entity_documents_returns_order_id_idx/, "linked-return order ID lookups must be indexed");
assert.match(dbSource, /options\.includeReturns === true/, "linked returns must be opt-in for bounded order reads");
assert.match(dbSource, /collection = 'returns'[\s\S]*data->>'orderId' = any\(\$1::text\[\]\)/, "detailed exports must batch linked returns by order ID");
assert.match(serverSource, /includeReturns: mode === "lines"/, "only line-item exports should request linked returns");

console.log("order export query tests passed");
