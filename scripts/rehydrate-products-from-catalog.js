const fs = require("fs");
const path = require("path");
const readline = require("readline");
const postgres = require("../db");

const ROOT = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
const DB_FILE = path.join(ROOT, "data", "db.json");
const CATALOG_FILE = path.join(ROOT, "data", "catalog", "products.ndjson");
const CATALOG_INDEX_DIR = path.join(ROOT, "data", "catalog", "index");
const CATALOG_INDEX_SKU_DIR = path.join(CATALOG_INDEX_DIR, "sku-shards");

function scalarValue(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    if (value.$numberDecimal !== undefined) return value.$numberDecimal;
    if (value.$date !== undefined) return scalarValue(value.$date);
    if (value._bsontype === "Decimal128" && typeof value.toString === "function") return value.toString();
    if (value._bsontype === "ObjectId" && typeof value.toString === "function") return value.toString();
  }
  return value;
}

function textValue(value) {
  const scalar = scalarValue(value);
  return scalar == null ? "" : String(scalar).trim();
}

function numberValue(value, fallback = 0) {
  const number = Number(scalarValue(value));
  return Number.isFinite(number) ? number : fallback;
}

function listValue(value) {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean);
  const text = textValue(value);
  if (!text) return [];
  return text.split(/[|,]/).map((item) => item.trim()).filter(Boolean);
}

function booleanValue(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true || value === false) return value;
  const text = textValue(value).toLowerCase();
  if (["true", "1", "yes", "y", "active"].includes(text)) return true;
  if (["false", "0", "no", "n", "inactive"].includes(text)) return false;
  return fallback;
}

function dimensionalWeightValue(record) {
  const length = numberValue(record.packageLength || record.package_length);
  const width = numberValue(record.packageWidth || record.package_width);
  const height = numberValue(record.packageHeight || record.package_height);
  if (!(length > 0 && width > 0 && height > 0)) return 0;
  return Math.round(((length * width * height) / 139) * 1000) / 1000;
}

function loadLocalEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function readAppState() {
  loadLocalEnv();
  const state = postgres.isPostgresEnabled() ? await postgres.readState() : null;
  if (state) {
    return {
      state,
      label: "PostgreSQL app_state",
      write: async (next) => {
        await postgres.writeState(next);
        fs.writeFileSync(DB_FILE, JSON.stringify(next, null, 2));
      }
    };
  }
  if (!fs.existsSync(DB_FILE)) throw new Error(`Missing ${DB_FILE}`);
  return {
    state: JSON.parse(fs.readFileSync(DB_FILE, "utf8")),
    label: "data/db.json",
    write: async (next) => fs.writeFileSync(DB_FILE, JSON.stringify(next, null, 2))
  };
}

function skuShardName(sku) {
  const key = String(sku || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return (key.slice(0, 2) || "__").padEnd(2, "_");
}

async function readCatalogProductAtOffset(handle, offset) {
  const chunks = [];
  const buffer = Buffer.alloc(8192);
  let position = Number(offset || 0);
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    const slice = buffer.subarray(0, bytesRead);
    const newline = slice.indexOf(10);
    if (newline >= 0) {
      chunks.push(slice.subarray(0, newline));
      break;
    }
    chunks.push(Buffer.from(slice));
    position += bytesRead;
  }
  const line = Buffer.concat(chunks).toString("utf8").trim();
  return line ? JSON.parse(line) : null;
}

function normalizeCatalogProduct(record) {
  const sku = textValue(record._id || record.sku || record.SKU || record.id);
  if (!sku) return null;
  const defaultImage = textValue(record.defaultImage || record.default_image || record.image || record.image_url);
  const images = [...new Set([defaultImage, ...listValue(record.images || record.image_urls)].filter(Boolean))];
  const stockQty = numberValue(record.stockQty ?? record.stock_qty ?? record.qty ?? record.quantity);
  const minQuantity = textValue(record.minQuantity || record.min_quantity);
  const checkedImage = record.checkedImage || record.checked_image || {};

  return {
    sku,
    externalId: textValue(record.externalId || record._id || record.id),
    title: textValue(record.title || record.name || sku),
    marketplaceTitle: textValue(record.marketplaceTitle || record.name || record.title || sku),
    shortDescription: textValue(record.shortDescription || record.short_description),
    longDescription: textValue(record.longDescription || record.description || record.long_description),
    bulletPoints: listValue(record.bulletPoints || record.bullet_points || record.keyFeatures || record.features),
    brand: textValue(record.brand),
    category: textValue(record.category || record.product_type),
    condition: textValue(record.condition) || "New",
    status: record.active === false ? "Draft" : textValue(record.status) || "Draft",
    active: booleanValue(record.active, true),
    barcode: textValue(record.barcode || record.upc || record.gtin),
    defaultImage,
    images,
    manufacturer: textValue(record.manufacturer),
    mfrPartNumber: textValue(record.mfrPartNumber || record.mfr_part_number),
    vendorSku: textValue(record.vendorSku || record.vendor_sku),
    supplier: textValue(record.supplier),
    supplierCode: textValue(record.supplierCode || record.supplier_code),
    vendor: textValue(record.vendor || record.supplier),
    unspsc: textValue(record.unspsc),
    uom: textValue(record.uom),
    uomQty: textValue(record.uomQty || record.uom_qty),
    minQuantity,
    quantityIncrements: textValue(record.quantityIncrements || record.quantity_increments),
    hazardous: booleanValue(record.hazardous, false),
    sdsUrl: textValue(record.sdsUrl || record.sds_url),
    itemHeight: numberValue(record.itemHeight || record.item_height),
    itemLength: numberValue(record.itemLength || record.item_length),
    itemWeight: numberValue(record.itemWeight || record.item_weight),
    itemWidth: numberValue(record.itemWidth || record.item_width),
    packageHeight: numberValue(record.packageHeight || record.package_height),
    packageLength: numberValue(record.packageLength || record.package_length),
    packageWeight: numberValue(record.packageWeight || record.package_weight),
    packageWidth: numberValue(record.packageWidth || record.package_width),
    dimensionalWeight: numberValue(record.dimensionalWeight || record.dimensional_weight) || dimensionalWeightValue(record),
    qty: stockQty,
    stockQty,
    stockStatus: textValue(record.stockStatus || record.stock_status),
    stockUpdatedAt: textValue(record.stockUpdatedAt || record.stock_updated_at),
    reorderPoint: numberValue(minQuantity),
    ctechId: textValue(record.ctechId || record.ctech_id),
    ctechIdLastExport: textValue(record.ctechIdLastExport || record.ctech_id_last_export),
    fobPrice: numberValue(record.fobPrice || record.fob_price),
    price: numberValue(record.price || record.sale_price || record.sell_price),
    cost: numberValue(record.cost || record.fob_price || record.wholesale_price),
    msrp: numberValue(record.msrp || record.list_price),
    wildcardSearch: textValue(record.wildcardSearch),
    tags: listValue(record.tags),
    attributes: record.attributes && typeof record.attributes === "object" ? record.attributes : {},
    productDumpCreatedAt: textValue(record.productDumpCreatedAt || record.created_at || record.createdAt),
    productDumpUpdatedAt: textValue(record.productDumpUpdatedAt || record.updated_at || record.updatedAt),
    inactiveMailedAt: textValue(record.inactiveMailedAt || record.inactive_mailed_at),
    validatedAt: textValue(record.validatedAt || record.validated_at),
    checkedImage: checkedImage && typeof checkedImage === "object" ? checkedImage : {},
    checkedImageUrl: textValue(checkedImage?.url),
    checkedImageError: textValue(checkedImage?.error),
    checkedImageSize: textValue(checkedImage?.size),
    checkedImageTimestamp: textValue(checkedImage?.timestamp),
    originalImage: textValue(record.originalImage || record.original_image),
    countryOfOrigin: textValue(record.countryOfOrigin || record.country_of_origin),
    original: record.original === undefined ? null : record.original,
    productManagerFields: record.productManagerFields && typeof record.productManagerFields === "object" ? record.productManagerFields : {},
    sources: { ...(record.sources || {}), catalog: sku },
    importedFrom: record.importedFrom || "source catalog",
    updatedAt: new Date().toISOString()
  };
}

function isShellProduct(item) {
  const sku = textValue(item.sku);
  if (!sku) return false;
  const title = textValue(item.title);
  const marketplaceTitle = textValue(item.marketplaceTitle);
  return (!title || title === sku || marketplaceTitle === sku)
    && !textValue(item.vendorSku || item.vendor_sku)
    && !textValue(item.supplier || item.vendor)
    && !textValue(item.defaultImage || item.default_image)
    && !textValue(item.shortDescription || item.short_description)
    && !textValue(item.longDescription || item.description);
}

async function findCatalogProductsBySku(skus) {
  const wanted = new Map(skus.map((sku) => [String(sku).toLowerCase(), sku]));
  const found = new Map();
  const byShard = new Map();
  for (const sku of wanted.keys()) {
    const shard = skuShardName(sku);
    if (!byShard.has(shard)) byShard.set(shard, new Set());
    byShard.get(shard).add(sku);
  }

  const catalogHandle = await fs.promises.open(CATALOG_FILE, "r");
  try {
    for (const [shard, shardWanted] of byShard) {
      const shardPath = path.join(CATALOG_INDEX_SKU_DIR, `${shard}.ndjson`);
      if (!fs.existsSync(shardPath)) continue;
      const rl = readline.createInterface({ input: fs.createReadStream(shardPath, { encoding: "utf8" }), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        let row;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        const key = String(row[0] || "").toLowerCase();
        if (!shardWanted.has(key)) continue;
        const product = await readCatalogProductAtOffset(catalogHandle, row[1]);
        if (product) found.set(key, product);
        shardWanted.delete(key);
        if (!shardWanted.size) {
          rl.close();
          break;
        }
      }
    }
  } finally {
    await catalogHandle.close();
  }
  return found;
}

function mergeHydratedProduct(existing, hydrated) {
  const wasShell = isShellProduct(existing);
  const keep = {
    id: existing.id,
    qty: wasShell ? hydrated.qty : existing.qty,
    reserved: existing.reserved || 0,
    reorderPoint: existing.reorderPoint ?? hydrated.reorderPoint,
    shadowSkus: Array.isArray(existing.shadowSkus) ? existing.shadowSkus : [],
    serialUnits: Array.isArray(existing.serialUnits) ? existing.serialUnits : [],
    warehouseStock: wasShell ? [] : Array.isArray(existing.warehouseStock) ? existing.warehouseStock : [],
    sources: { ...(hydrated.sources || {}), ...(existing.sources || {}), catalog: hydrated.sku }
  };
  return { ...existing, ...hydrated, ...keep, updatedAt: new Date().toISOString() };
}

async function main() {
  if (!fs.existsSync(CATALOG_FILE)) throw new Error(`Missing ${CATALOG_FILE}`);
  if (!fs.existsSync(CATALOG_INDEX_SKU_DIR)) throw new Error(`Missing ${CATALOG_INDEX_SKU_DIR}. Run npm run catalog:index first.`);

  const appState = await readAppState();
  const db = appState.state;
  db.inventory = Array.isArray(db.inventory) ? db.inventory : [];
  const candidates = db.inventory.filter(isShellProduct).map((item) => item.sku);
  console.log(`Using ${appState.label}. Found ${candidates.length} shell products to rehydrate.`);
  if (!candidates.length) return;

  const products = await findCatalogProductsBySku(candidates);
  let repaired = 0;
  let missing = 0;
  db.inventory = db.inventory.map((item) => {
    if (!isShellProduct(item)) return item;
    const source = products.get(String(item.sku || "").toLowerCase());
    if (!source) {
      missing += 1;
      return item;
    }
    repaired += 1;
    if (repaired % 1000 === 0) console.log(`Rehydrated ${repaired} products...`);
    return mergeHydratedProduct(item, normalizeCatalogProduct(source));
  });

  await appState.write(db);
  console.log(`Done. Rehydrated ${repaired} products. Missing from source catalog: ${missing}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => postgres.closePool());
