const assert = require("node:assert/strict");
const { selectEbayCategoryMappings, selectWalmartCategoryMappings } = require("../lib/bulk-category-mapping");

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

const ebay = selectEbayCategoryMappings([
  { entity_id: "one", data: { name: "Mapped", mappings: { ebay: { status: "mapped", categoryId: "1", pendingSuggestion: { categoryId: "2" } } } } },
  { entity_id: "two", data: { name: "Pending", mappings: { ebay: { pendingSuggestion: { categoryId: "3", confidence: 0.1 } } } } },
  { entity_id: "three", data: { name: "No suggestion", mappings: { ebay: {} } } }
]);
assert.deepEqual(ebay.map((row) => row.record.entity_id), ["two"]);

console.log("PASS bulk marketplace mapping preserves existing assignments and selects saved suggestions");
