const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "..");
const SERVER_FILE = path.join(ROOT, "server.js");
const OUTPUT_FILE = path.join(ROOT, "outputs", `shopify-full-template-exact-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
const TEMPLATE_ID = "bfdc1242-7a78-4a22-8d81-b3f335636c9e";

function loadServerExportEngine() {
  const source = fs.readFileSync(SERVER_FILE, "utf8");
  const start = source.lastIndexOf("\nensureDb();");
  if (start < 0) throw new Error("Could not find server bootstrap section.");
  const exposed = `
categoryMappingForProduct = (() => {
  const original = categoryMappingForProduct;
  const cache = new Map();
  return function cachedCategoryMappingForProduct(db, item, channel = "shopify") {
    const key = [channel, formatCategoryName(item.category || "").toLowerCase()].join("|");
    if (cache.has(key)) return cache.get(key);
    const value = original(db, item, channel);
    cache.set(key, value);
    return value;
  };
})();

globalThis.__DATAPLUS_EXPORT_ENGINE__ = {
  readDb,
  exportMappingsForTemplate,
  isShopifyTemplate,
  shopifyPurchaseVariants,
  productFieldValue,
  formatMappedExportValue,
  escapeCsv,
  mappedExportFilename
};
`;
  const code = `${source.slice(0, start)}\n${exposed}`;
  const context = {
    console,
    Buffer,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setImmediate,
    clearImmediate,
    __dirname: ROOT,
    __filename: SERVER_FILE,
    require: createRequire(SERVER_FILE),
    process
  };
  vm.runInNewContext(code, context, { filename: SERVER_FILE });
  return context.__DATAPLUS_EXPORT_ENGINE__;
}

async function writeLine(stream, line) {
  if (!stream.write(line)) {
    await new Promise((resolve) => stream.once("drain", resolve));
  }
}

async function main() {
  const started = Date.now();
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  console.log("Loading DataPlus export engine...");
  const engine = loadServerExportEngine();
  console.log("Reading normalized database...");
  const db = await engine.readDb();
  const template = (db.exportMappings || []).find((row) => row.id === TEMPLATE_ID);
  if (!template) throw new Error(`Missing export template ${TEMPLATE_ID}`);
  const mappings = engine.exportMappingsForTemplate(template);
  const totalProducts = (db.inventory || []).length;
  const stream = fs.createWriteStream(OUTPUT_FILE, { encoding: "utf8" });
  await writeLine(stream, mappings.map((mapping) => engine.escapeCsv(mapping.externalColumn)).join(",") + "\n");

  let productCount = 0;
  let rowCount = 0;
  for (const item of db.inventory || []) {
    productCount += 1;
    const exportItems = engine.isShopifyTemplate(template)
      ? engine.shopifyPurchaseVariants(item, db).map((variant, index) => ({ ...item, __shopifyVariant: variant, __shopifyVariantRow: index + 1 }))
      : [item];
    for (const exportItem of exportItems) {
      const row = mappings.map((mapping) => {
        const value = engine.productFieldValue(db, exportItem, mapping.productField, {
          ...mapping,
          templateSource: template.source,
          templateId: template.id
        });
        const formatted = engine.formatMappedExportValue(value, mapping, exportItem);
        return engine.escapeCsv(formatted === "" || formatted === undefined || formatted === null ? mapping.defaultValue || "" : formatted);
      });
      await writeLine(stream, row.join(",") + "\n");
      rowCount += 1;
    }
    if (productCount % 2500 === 0 || productCount === totalProducts) {
      const elapsed = (Date.now() - started) / 1000;
      const perSecond = productCount / Math.max(1, elapsed);
      const remaining = Math.max(0, Math.round((totalProducts - productCount) / Math.max(1, perSecond)));
      console.log(`${productCount.toLocaleString()} / ${totalProducts.toLocaleString()} products, ${rowCount.toLocaleString()} rows, ETA ${remaining}s`);
    }
  }

  await new Promise((resolve) => stream.end(resolve));
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const sizeMb = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(1);
  console.log(JSON.stringify({ output: OUTPUT_FILE, products: productCount, rows: rowCount, seconds, sizeMb }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
