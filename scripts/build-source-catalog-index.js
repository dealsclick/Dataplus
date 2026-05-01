const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ROOT = path.join(__dirname, "..");
const CATALOG_FILE = path.join(ROOT, "data", "catalog", "products.ndjson");
const INDEX_DIR = path.join(ROOT, "data", "catalog", "index");
const SUPPLIER_DIR = path.join(INDEX_DIR, "suppliers");
const SKU_DIR = path.join(INDEX_DIR, "sku-shards");
const MANIFEST_FILE = path.join(INDEX_DIR, "manifest.json");
const SUPPLIER_MANIFEST_FILE = path.join(INDEX_DIR, "suppliers.json");

function slug(value) {
  const text = String(value || "unknown")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || "unknown";
}

function shardForSku(sku) {
  const key = String(sku || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return (key.slice(0, 2) || "__").padEnd(2, "_");
}

function summary(product = {}) {
  return {
    id: product.id || product.sku,
    sku: product.sku || "",
    title: product.title || product.marketplaceTitle || "",
    marketplaceTitle: product.marketplaceTitle || product.title || "",
    brand: product.brand || "",
    category: product.category || "",
    manufacturer: product.manufacturer || "",
    mfrPartNumber: product.mfrPartNumber || "",
    vendorSku: product.vendorSku || "",
    supplier: product.supplier || product.vendor || "",
    supplierCode: product.supplierCode || "",
    stockStatus: product.stockStatus || "",
    hazardous: Boolean(product.hazardous),
    price: Number(product.price || 0),
    cost: Number(product.cost || 0),
    msrp: Number(product.msrp || 0),
    stockQty: Number(product.stockQty ?? product.qty ?? 0),
    active: product.active !== false,
    status: product.status || "Draft",
    defaultImage: product.defaultImage || "",
    images: Array.isArray(product.images) ? product.images.slice(0, 4) : [],
    zoroSku: product.zoroSku || "",
    zoroPrice: Number(product.zoroPrice || 0),
    varisContractPrice: Number(product.varisContractPrice || 0),
    countryOfOrigin: product.countryOfOrigin || "",
    productManagerFieldCount: product.productManagerFields ? Object.keys(product.productManagerFields).length : 0
  };
}

function ensureCleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function writeLine(writer, line) {
  return new Promise((resolve, reject) => {
    writer.write(line, (error) => error ? reject(error) : resolve());
  });
}

async function main() {
  if (!fs.existsSync(CATALOG_FILE)) throw new Error(`Missing catalog file: ${CATALOG_FILE}`);
  ensureCleanDir(SUPPLIER_DIR);
  ensureCleanDir(SKU_DIR);

  const supplierWriters = new Map();
  const skuShardRows = new Map();
  const suppliers = new Map();
  const catalogStat = fs.statSync(CATALOG_FILE);
  let count = 0;
  let offset = 0;
  let nextLog = 100000;

  const stream = fs.createReadStream(CATALOG_FILE, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const lineOffset = offset;
    offset += Buffer.byteLength(line, "utf8") + 1;
    if (!line.trim()) continue;
    let product;
    try { product = JSON.parse(line); } catch { continue; }
    const sku = String(product.sku || "").trim();
    if (!sku) continue;
    const supplier = String(product.supplier || product.vendor || "Unknown supplier").trim() || "Unknown supplier";
    let supplierInfo = suppliers.get(supplier);
    if (!supplierInfo) {
      const base = slug(supplier);
      let fileSlug = base;
      let suffix = 2;
      while ([...suppliers.values()].some((item) => item.fileSlug === fileSlug)) fileSlug = `${base}-${suffix++}`;
      supplierInfo = { name: supplier, fileSlug, productCount: 0, file: `suppliers/${fileSlug}.ndjson` };
      suppliers.set(supplier, supplierInfo);
    }
    supplierInfo.productCount += 1;
    let writer = supplierWriters.get(supplierInfo.fileSlug);
    if (!writer) {
      writer = fs.createWriteStream(path.join(SUPPLIER_DIR, `${supplierInfo.fileSlug}.ndjson`), { encoding: "utf8" });
      supplierWriters.set(supplierInfo.fileSlug, writer);
    }
    await writeLine(writer, `${JSON.stringify(summary(product))}\n`);

    const shard = shardForSku(sku);
    const rows = skuShardRows.get(shard) || [];
    rows.push([sku.toLowerCase(), lineOffset]);
    skuShardRows.set(shard, rows);
    if (rows.length >= 50000) {
      fs.appendFileSync(path.join(SKU_DIR, `${shard}.ndjson`), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
      skuShardRows.set(shard, []);
    }

    count += 1;
    if (count >= nextLog) {
      process.stderr.write(`Indexed ${count.toLocaleString()} products\r`);
      nextLog += 100000;
    }
  }

  for (const [shard, rows] of skuShardRows) {
    if (rows.length) fs.appendFileSync(path.join(SKU_DIR, `${shard}.ndjson`), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  }
  await Promise.all([...supplierWriters.values()].map((writer) => new Promise((resolve) => writer.end(resolve))));

  const supplierList = [...suppliers.values()].sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(SUPPLIER_MANIFEST_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), suppliers: supplierList }, null, 2));
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), catalogFile: CATALOG_FILE, catalogMtimeMs: catalogStat.mtimeMs, catalogSize: catalogStat.size, productCount: count, supplierCount: supplierList.length }, null, 2));
  process.stderr.write("\n");
  console.log(`Indexed ${count.toLocaleString()} products across ${supplierList.length.toLocaleString()} suppliers.`);
  console.log(`Index written to ${INDEX_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
