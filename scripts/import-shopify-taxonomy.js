const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "channel-taxonomies", "shopify");
const OUT_FILE = path.join(OUT_DIR, "taxonomy-index.json");
const SOURCE_URL = "https://raw.githubusercontent.com/Shopify/product-taxonomy/main/dist/en/categories.json";
const GOOGLE_MAPPING_URL = "https://raw.githubusercontent.com/Shopify/product-taxonomy/main/dist/en/integrations/all_mappings.json";

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "dataplus-taxonomy-importer" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchText(new URL(res.headers.location, url).toString()).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Unable to download Shopify taxonomy: HTTP ${res.statusCode}`));
        return;
      }
      res.setEncoding("utf8");
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

function googleMappingsByShopifyCategory(mappingSource) {
  const map = new Map();
  for (const mapping of mappingSource.mappings || []) {
    if (!String(mapping.output_taxonomy || "").startsWith("google/")) continue;
    for (const rule of mapping.rules || []) {
      const inputId = rule.input?.category?.id || "";
      const output = Array.isArray(rule.output?.category) ? rule.output.category[0] : null;
      if (!inputId || !output) continue;
      map.set(inputId, {
        id: output.id || "",
        fullName: output.full_name || "",
        breadcrumb: output.full_name || "",
        taxonomy: mapping.output_taxonomy || ""
      });
    }
  }
  return map;
}

function flattenTaxonomy(source, googleMappings = new Map()) {
  const categories = [];
  for (const vertical of source.verticals || []) {
    for (const category of vertical.categories || []) {
      const fullName = category.full_name || category.name || "";
      const pathParts = fullName.split(" > ").map((part) => part.trim()).filter(Boolean);
      const attributes = (category.attributes || []).map((attribute) => ({
        id: attribute.id || "",
        name: attribute.name || "",
        handle: attribute.handle || "",
        description: attribute.description || "",
        extended: Boolean(attribute.extended)
      })).filter((attribute) => attribute.id || attribute.name);
      categories.push({
        id: category.id || "",
        handle: String(category.id || "").split("/").pop() || "",
        name: category.name || pathParts[pathParts.length - 1] || "",
        fullName,
        path: pathParts,
        level: Number(category.level || 0),
        parentId: category.parent_id || "",
        vertical: vertical.name || pathParts[0] || "",
        googleCategory: googleMappings.get(category.id || "") || null,
        attributeCount: attributes.length,
        attributes
      });
    }
  }
  categories.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return {
    channel: "shopify",
    source: SOURCE_URL,
    version: source.version || "",
    generatedAt: new Date().toISOString(),
    categoryCount: categories.length,
    categories
  };
}

async function main() {
  console.log(`Downloading Shopify taxonomy from ${SOURCE_URL}`);
  const body = await fetchText(SOURCE_URL);
  console.log(`Downloading Shopify Google mappings from ${GOOGLE_MAPPING_URL}`);
  const mappingBody = await fetchText(GOOGLE_MAPPING_URL);
  const source = JSON.parse(body);
  const mappings = JSON.parse(mappingBody);
  const index = flattenTaxonomy(source, googleMappingsByShopifyCategory(mappings));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(index, null, 2));
  console.log(`Wrote ${index.categoryCount.toLocaleString()} Shopify categories to ${OUT_FILE}`);
  console.log(`Version: ${index.version}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
