const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dbSource = fs.readFileSync(path.join(root, "db.js"), "utf8");
const importerSource = fs.readFileSync(path.join(root, "scripts", "import-product-dump.js"), "utf8");

assert.match(
  dbSource,
  /const mainConflictClause = catalogOnly[\s\S]*?: !reconciliationOnly[\s\S]*?internal_sku = excluded\.internal_sku,[\s\S]*?mfr_part_number = excluded\.mfr_part_number,[\s\S]*?barcode = excluded\.barcode/,
  "split imports must refresh supplier source identifiers instead of freezing the first imported values"
);
assert.match(
  dbSource,
  /const dynamicOnly = \["split", "reconciliation"\]\.includes\(syncMode\)/,
  "split imports should continue limiting change-event noise to commercial fields"
);
assert.match(
  importerSource,
  /syncMode:\s*"split"/,
  "the routine product dump should continue using the split source/commercial workflow"
);

console.log("Product dump split imports refresh supplier identifiers while preserving focused change events.");
