const assert = require("node:assert/strict");
const { selectWalmartCategoryMappings } = require("../lib/bulk-category-mapping");

const result = selectWalmartCategoryMappings(
  ["Tools > Hammers", "Garden > Rakes", "Exact > Full Path", "Unknown"],
  [
    { productType: "Claw Hammers", path: "Tools > Hammers > Claw Hammers" },
    { productType: "Rakes", path: "Patio & Garden > Gardening Tools > Rakes" },
    { productType: "Full Path", path: "Exact > Full Path" }
  ],
  [{ category: "Tools > Hammers", confidence: 0.35, suggestion: { productType: "Claw Hammers" } }],
  []
);
assert.equal(result.selected.length, 3);
assert.equal(result.selected.find((row) => row.category === "Tools > Hammers").matchSource, "saved-review-suggestion");
assert.equal(result.selected.find((row) => row.category === "Garden > Rakes").matchSource, "unique-exact-product-type");
assert.equal(result.selected.find((row) => row.category === "Exact > Full Path").matchSource, "exact-taxonomy-path");
assert.deepEqual(result.missing.map((row) => row.category), ["Unknown"]);
console.log("PASS bulk Walmart mapping preserves suggestions and uses only exact fallback matches");
