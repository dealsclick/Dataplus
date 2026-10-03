function text(value) {
  return String(value || "").trim();
}

function normalized(value) {
  return text(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryLeaf(value) {
  const parts = text(value).split(">").map(text).filter(Boolean);
  return parts.at(-1) || "";
}

function selectWalmartCategoryMappings(categories = [], taxonomyRows = [], reviews = [], existingMappings = []) {
  const taxonomyByType = new Map();
  const taxonomyByPath = new Map();
  const taxonomyByLeaf = new Map();
  for (const row of taxonomyRows) {
    const productType = text(row?.productType);
    if (!productType) continue;
    taxonomyByType.set(productType.toLowerCase(), row);
    const pathKey = normalized(row.path);
    if (pathKey && !taxonomyByPath.has(pathKey)) taxonomyByPath.set(pathKey, row);
    const leafKey = normalized(productType);
    if (!taxonomyByLeaf.has(leafKey)) taxonomyByLeaf.set(leafKey, []);
    taxonomyByLeaf.get(leafKey).push(row);
  }
  const currentByCategory = new Map(existingMappings.map((row) => [text(row?.category).toLowerCase(), row]));
  const reviewByCategory = new Map();
  for (const review of reviews) {
    const key = text(review?.category).toLowerCase();
    if (key && !reviewByCategory.has(key)) reviewByCategory.set(key, review);
  }

  const selected = [];
  const missing = [];
  const seenCategories = new Set();
  for (const category of categories.map(text).filter(Boolean)) {
    const key = category.toLowerCase();
    if (seenCategories.has(key)) continue;
    seenCategories.add(key);
    if (currentByCategory.get(key)?.productType) continue;
    const review = reviewByCategory.get(key);
    const suggestion = review?.suggestion || {};
    let taxonomy = taxonomyByType.get(text(suggestion.productType || suggestion.categoryId).toLowerCase());
    let matchSource = taxonomy ? "saved-review-suggestion" : "";
    if (!taxonomy) {
      taxonomy = taxonomyByPath.get(normalized(category));
      matchSource = taxonomy ? "exact-taxonomy-path" : "";
    }
    if (!taxonomy) {
      const leafRows = taxonomyByLeaf.get(normalized(categoryLeaf(category))) || [];
      if (leafRows.length === 1) {
        taxonomy = leafRows[0];
        matchSource = "unique-exact-product-type";
      }
    }
    if (!taxonomy) {
      missing.push({ category, reason: review?.rationale || "No saved or exact Walmart taxonomy match." });
      continue;
    }
    selected.push({
      category,
      productType: taxonomy.productType,
      path: taxonomy.path || taxonomy.productType,
      confidence: Number(review?.confidence ?? suggestion.confidence ?? (matchSource.startsWith("exact") || matchSource.startsWith("unique") ? 1 : 0)),
      matchSource,
      review
    });
  }
  return { selected, missing };
}

module.exports = { selectWalmartCategoryMappings };
