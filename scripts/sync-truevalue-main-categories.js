const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const postgres = require("../db");

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
const TAXONOMY_FILE = path.join(ROOT, "data", "channel-taxonomies", "shopify", "taxonomy-index.json");
const OUT_DIR = path.join(ROOT, "outputs", "category-sync");

function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function sourceText(value) {
  return String(value || "").trim();
}

function formatCategoryName(value) {
  return sourceText(value)
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()).replace(/\b(?:Usa|Usb|Led|Pvc|Hvac|Nsf|Ansi|Astm|Osha|Ada|Gfci)\b/g, (word) => word.toUpperCase()))
    .join(" > ");
}

function categoryTypeValue(value) {
  const parts = sourceText(value).split(">").map((part) => part.trim()).filter(Boolean);
  return parts.slice(-2).join(" > ") || parts[0] || "";
}

function smartCollectionTitle(productType = "") {
  const parts = sourceText(productType).split(">").map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) || sourceText(productType);
}

function smartCollectionHandle(productType = "") {
  return sourceText(productType)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase()
    .slice(0, 240);
}

function categoryIdForName(name = "") {
  return `main-${crypto.createHash("sha1").update(formatCategoryName(name).toLowerCase()).digest("hex").slice(0, 16)}`;
}

function tokenize(value = "") {
  const stop = new Set(["and", "the", "for", "with", "accessories", "accessory", "equipment", "power", "outdoor", "living", "attachment", "attachments", "cordless", "electric", "rotary"]);
  return sourceText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !stop.has(token));
}

function singular(token = "") {
  return token.replace(/ies$/, "y").replace(/s$/, "");
}

function taxonomyCandidates(index = []) {
  return index.map((category) => ({
    ...category,
    _haystack: sourceText(`${category.fullName || ""} ${category.name || ""}`).toLowerCase(),
    _tokens: new Set(tokenize(`${category.fullName || ""} ${category.name || ""}`).map(singular))
  }));
}

function scoreTaxonomyCategory(category, mainCategory = "") {
  const parts = sourceText(mainCategory).split(">").map((part) => part.trim()).filter(Boolean);
  const leaf = parts.at(-1) || mainCategory;
  const parent = parts.at(-2) || "";
  const leafTokens = tokenize(leaf).map(singular);
  const parentTokens = tokenize(parent).map(singular);
  if (!leafTokens.length) return 0;
  let score = 0;
  const leafText = leaf.toLowerCase();
  const categoryName = sourceText(category.name).toLowerCase();
  const fullName = sourceText(category.fullName).toLowerCase();
  if (categoryName === leafText) score += 120;
  if (fullName.includes(leafText)) score += 70;
  for (const token of leafTokens) {
    if (category._tokens.has(token)) score += 28;
    if (categoryName.includes(token)) score += 14;
  }
  for (const token of parentTokens) {
    if (category._tokens.has(token)) score += 8;
  }
  if (/lawn|garden|mower|trimmer|edger|blower|chainsaw|snow|pressure|tiller|tractor|hedge|weed/.test(`${leafText} ${parent.toLowerCase()}`) && fullName.includes("lawn & garden")) score += 30;
  if (/accessor|attachment|blade|belt|cover|bag|wheel|tire|spindle|pulley/.test(leafText) && fullName.includes("accessories")) score += 20;
  if (!/pet|beauty|health|candle/.test(`${leafText} ${parent.toLowerCase()}`) && /animals|health & beauty|candle/.test(fullName)) score -= 80;
  score += Math.min(20, Number(category.level || 0) * 2);
  return score;
}

function suggestShopifyTaxonomy(mainCategory = "", taxonomyRows = []) {
  const direct = directShopifyTaxonomyRule(mainCategory, taxonomyRows);
  if (direct) return direct;
  const ranked = taxonomyRows
    .map((category) => ({ category, score: scoreTaxonomyCategory(category, mainCategory) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || sourceText(b.category.fullName).length - sourceText(a.category.fullName).length);
  const best = ranked[0];
  if (!best || best.score < 80) return { mapping: null, score: best?.score || 0, candidates: ranked.slice(0, 5) };
  const category = best.category;
  return {
    mapping: {
      categoryId: category.id || "",
      categoryPath: category.fullName || category.name || "",
      categoryHandle: category.handle || "",
      collectionHandle: "",
      taxonomyVersion: "",
      googleCategory: category.googleCategory || null,
      attributes: [],
      attributeMappings: [],
      status: "mapped",
      notes: `Auto-mapped from Shopify taxonomy score ${best.score}. Review before relying on this category for new marketplace rules.`
    },
    score: best.score,
    candidates: ranked.slice(0, 5)
  };
}

function directShopifyTaxonomyRule(mainCategory = "", taxonomyRows = []) {
  const text = sourceText(mainCategory).toLowerCase();
  const rules = [
    { test: /hedge trimmer(?!.*accessor|.*blade|.*cover|.*guard|.*attachment)/, id: "gid://shopify/TaxonomyCategory/hg-12-3-3", score: 500 },
    { test: /(electric rotary mower|walk behind mower|walk-behind mower)/, id: "gid://shopify/TaxonomyCategory/hg-12-3-5-4", score: 500 },
    { test: /grass trimmer(?!.*line|.*spool|.*blade|.*accessor)|weed trimmer(?!.*line|.*spool|.*blade|.*accessor)/, id: "gid://shopify/TaxonomyCategory/hg-12-3-15", score: 480 },
    { test: /(power blower|leaf blower)(?!.*accessor|.*attachment)/, id: "gid://shopify/TaxonomyCategory/hg-12-3-7", score: 480 },
    { test: /(lawn edger|grass edger)(?!.*blade|.*accessor|.*attachment)/, id: "gid://shopify/TaxonomyCategory/hg-12-3-2", score: 480 },
    { test: /(replacement trimmer line|trimmer line|spool)/, id: "gid://shopify/TaxonomyCategory/hg-12-4-11-1-3", score: 460 },
    { test: /(lawn mower).*(blade|adapter)/, id: "gid://shopify/TaxonomyCategory/hg-12-4-4-4", score: 460 },
    { test: /(power equipment batteries|outdoor power equipment batteries)/, id: "gid://shopify/TaxonomyCategory/hg-12-4-7", score: 460 }
  ];
  const rule = rules.find((row) => row.test.test(text));
  if (!rule) return null;
  const category = taxonomyRows.find((row) => row.id === rule.id);
  if (!category) return null;
  return {
    mapping: {
      categoryId: category.id || "",
      categoryPath: category.fullName || category.name || "",
      categoryHandle: category.handle || "",
      collectionHandle: "",
      taxonomyVersion: "",
      googleCategory: category.googleCategory || null,
      attributes: [],
      attributeMappings: [],
      status: "mapped",
      notes: `Auto-mapped from explicit True Value category rule score ${rule.score}.`
    },
    score: rule.score,
    candidates: [{ category, score: rule.score }]
  };
}

function normalizeChannelMapping(mapping = {}) {
  return {
    categoryId: mapping.categoryId || "",
    categoryPath: mapping.categoryPath || "",
    categoryHandle: mapping.categoryHandle || "",
    collectionHandle: mapping.collectionHandle || "",
    taxonomyVersion: mapping.taxonomyVersion || "",
    googleCategory: mapping.googleCategory || null,
    attributes: Array.isArray(mapping.attributes) ? mapping.attributes : [],
    attributeMappings: Array.isArray(mapping.attributeMappings) ? mapping.attributeMappings : [],
    status: mapping.status || (mapping.categoryId || mapping.categoryPath ? "mapped" : "missing"),
    notes: mapping.notes || ""
  };
}

function normalizeCategorySetting(row = {}) {
  const name = formatCategoryName(row.name || row.category || "");
  const productType = categoryTypeValue(row.smartCollection?.productType || name);
  const createdAt = row.createdAt || new Date().toISOString();
  const createdSource = row.createdSource || row.source || "system:true-value";
  return {
    id: row.id || categoryIdForName(name),
    categoryId: row.categoryId || categoryIdForName(name),
    name,
    scope: "main",
    status: row.status || "mapped",
    owner: row.owner || "",
    notes: row.notes || "",
    mappings: {
      shopify: normalizeChannelMapping(row.mappings?.shopify),
      temu: normalizeChannelMapping(row.mappings?.temu),
      tiktok: normalizeChannelMapping(row.mappings?.tiktok),
      ebay: normalizeChannelMapping(row.mappings?.ebay),
      whatnot: normalizeChannelMapping(row.mappings?.whatnot)
    },
    smartCollection: {
      enabled: row.smartCollection?.enabled !== false,
      productType,
      handle: row.smartCollection?.handle || smartCollectionHandle(productType),
      title: row.smartCollection?.title || smartCollectionTitle(productType),
      bodyHtml: row.smartCollection?.bodyHtml || "",
      sortOrder: row.smartCollection?.sortOrder || "Best Selling",
      templateSuffix: row.smartCollection?.templateSuffix || "",
      published: row.smartCollection?.published === undefined ? true : Boolean(row.smartCollection.published),
      publishedScope: row.smartCollection?.publishedScope || "global",
      mustMatch: row.smartCollection?.mustMatch || "all conditions",
      ruleProductColumn: row.smartCollection?.ruleProductColumn || "Type",
      ruleRelation: row.smartCollection?.ruleRelation || "Equals",
      imageSrc: row.smartCollection?.imageSrc || "",
      imageAltText: row.smartCollection?.imageAltText || smartCollectionTitle(productType),
      titleTag: row.smartCollection?.titleTag || `${smartCollectionTitle(productType)} on Sale`,
      descriptionTag: row.smartCollection?.descriptionTag || ""
    },
    defaults: row.defaults || {},
    requiredAttributes: Array.isArray(row.requiredAttributes) ? row.requiredAttributes : [],
    createdBy: row.createdBy || (createdSource === "system:true-value" ? "System - True Value" : ""),
    updatedBy: row.updatedBy || row.createdBy || "",
    createdSource,
    createdAt,
    updatedAt: new Date().toISOString()
  };
}

async function main() {
  loadEnv();
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_FILE, "utf8"));
  const taxonomyRows = taxonomyCandidates(taxonomy.categories || []);
  const categoryRows = await postgres.listCategoryProductStats();
  const existing = await postgres.readStateField("categorySettings").catch(() => []) || [];
  const byName = new Map((Array.isArray(existing) ? existing : []).map((row) => [formatCategoryName(row.name).toLowerCase(), normalizeCategorySetting(row)]));
  const report = { created: [], updated: [], mapped: [], needsReview: [], taxonomyVersion: taxonomy.version || "", categoryRows: categoryRows.length };
  for (const raw of categoryRows) {
    const name = formatCategoryName(raw.name || "");
    if (!name || name === "Uncategorized") continue;
    const key = name.toLowerCase();
    const current = byName.get(key) || normalizeCategorySetting({ name });
    const productType = categoryTypeValue(name);
    current.name = name;
    current.categoryId = current.categoryId || categoryIdForName(name);
    current.id = current.id || current.categoryId;
    current.scope = "main";
    current.status = current.status || "mapped";
    current.smartCollection = {
      ...current.smartCollection,
      productType: current.smartCollection?.productType || productType,
      handle: current.smartCollection?.handle || smartCollectionHandle(productType),
      title: current.smartCollection?.title || smartCollectionTitle(productType),
      ruleProductColumn: "Type",
      ruleRelation: "Equals"
    };
    const existingNotes = sourceText(current.mappings.shopify.notes).toLowerCase();
    const canAutoReplace = !current.mappings.shopify.categoryId
      || existingNotes.includes("auto-mapped from shopify taxonomy")
      || existingNotes.includes("auto-mapped from explicit true value");
    if (canAutoReplace) {
      const suggestion = suggestShopifyTaxonomy(name, taxonomyRows);
      if (suggestion.mapping) {
        current.mappings.shopify = normalizeChannelMapping({ ...suggestion.mapping, taxonomyVersion: taxonomy.version || "" });
        report.mapped.push({ mainCategory: name, productType, score: suggestion.score, shopifyCategory: suggestion.mapping.categoryPath, shopifyCategoryId: suggestion.mapping.categoryId });
      } else {
        report.needsReview.push({
          mainCategory: name,
          productType,
          bestScore: suggestion.score,
          candidates: suggestion.candidates.map((row) => ({ score: row.score, category: row.category.fullName, id: row.category.id }))
        });
      }
    }
    current.updatedAt = new Date().toISOString();
    if (byName.has(key)) report.updated.push({ mainCategory: name, productCount: Number(raw.productCount || 0) });
    else report.created.push({ mainCategory: name, productCount: Number(raw.productCount || 0) });
    byName.set(key, current);
  }
  const next = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  await postgres.writeStateDocuments({ categorySettings: next });
  await postgres.upsertCategoryChannelMappingsFromState(next);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `truevalue-main-category-sync-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify({ ...report, totalSettings: next.length }, null, 2));
  console.log(JSON.stringify({ output: out, totalSettings: next.length, created: report.created.length, updated: report.updated.length, mapped: report.mapped.length, needsReview: report.needsReview.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
