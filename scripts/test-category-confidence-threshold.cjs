const assert = require("node:assert/strict");
const { categorySuggestionsAtConfidence } = require("../server");

const mapping = (confidence, categoryId = "gid://shopify/TaxonomyCategory/test") => ({
  status: "needs_review",
  pendingSuggestion: { categoryId, confidence }
});

const db = {
  categorySettings: [
    { id: "high", name: "High", mappings: { shopify: mapping(0.85), ebay: mapping(0.8, "123") } },
    { id: "edge", name: "Edge", mappings: { shopify: mapping(0.6) } },
    { id: "low", name: "Low", mappings: { shopify: mapping(0.59), ebay: mapping(0.4, "456") } },
    { id: "blank", name: "Blank", mappings: { shopify: mapping(0.9, "") } }
  ]
};

const results = categorySuggestionsAtConfidence(db, { minimumConfidence: 0.6, channels: ["shopify", "ebay"] });
assert.deepEqual(results.find((row) => row.channel === "shopify").categories, ["High", "Edge"]);
assert.deepEqual(results.find((row) => row.channel === "ebay").categories, ["High"]);
console.log("PASS category confidence threshold includes 60% exactly and excludes lower or blank suggestions");
