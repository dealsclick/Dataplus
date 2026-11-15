const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dbSource = fs.readFileSync(path.join(root, "db.js"), "utf8");
const importerSource = fs.readFileSync(path.join(root, "scripts", "import-product-dump.js"), "utf8");

assert.match(
  dbSource,
  /const mainConflictClause = catalogOnly[\s\S]*?: !reconciliationOnly[\s\S]*?internal_sku = case[\s\S]*?mfr_part_number = case[\s\S]*?barcode = case/,
  "split imports must fill missing supplier identifiers without overwriting established identity"
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

assert.match(
  dbSource,
  /async function fillMissingProductIdentifiersFromVendorCatalog[\s\S]*?product\.barcode is distinct from targets\.next_barcode/,
  "the managed catalog must receive targeted UPC and MPN fills without a full reconciliation"
);
assert.doesNotMatch(
  dbSource,
  /update products product[\s\S]{0,1200}set sku\s*=/,
  "the targeted identifier fill must never rename a managed SKU"
);

console.log("Product dump imports preserve SKU identity and fill only missing UPC and MPN values.");
