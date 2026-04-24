const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { BSON } = require("bson");
const ftp = require("basic-ftp");
const { readState, writeState, closePool } = require("../db");

const ROOT = path.join(__dirname, "..");
const DEFAULT_LOCAL_DUMP = path.join(ROOT, "data", "imports", "products.bson.gz");

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const options = {
    source: "",
    downloadFtp: false,
    dryRun: false,
    inspect: false,
    limit: 0
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ftp") {
      options.downloadFtp = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--inspect") {
      options.inspect = true;
    } else if (arg === "--limit") {
      options.limit = Number(argv[index + 1] || 0);
      index += 1;
    } else if (!options.source) {
      options.source = arg;
    }
  }

  return options;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function downloadFromFtp(destinationPath) {
  const host = process.env.PRODUCT_DUMP_FTP_HOST;
  const user = process.env.PRODUCT_DUMP_FTP_USER;
  const password = process.env.PRODUCT_DUMP_FTP_PASSWORD;
  const port = Number(process.env.PRODUCT_DUMP_FTP_PORT || 21);
  const remotePath = process.env.PRODUCT_DUMP_FTP_REMOTE_PATH || "/dump/datawarehouse/products.bson.gz";

  if (!host || !user || !password) {
    throw new Error("FTP import needs PRODUCT_DUMP_FTP_HOST, PRODUCT_DUMP_FTP_USER, and PRODUCT_DUMP_FTP_PASSWORD in .env.");
  }

  ensureParentDir(destinationPath);
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host,
      port,
      user,
      password,
      secure: false
    });
    await client.downloadTo(destinationPath, remotePath);
  } finally {
    client.close();
  }
}

function numberValue(value, fallback = 0) {
  const number = Number(scalarValue(value));
  return Number.isFinite(number) ? number : fallback;
}

function textValue(value) {
  const scalar = scalarValue(value);
  return scalar == null ? "" : String(scalar).trim();
}

function listValue(value) {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean);
  const text = textValue(value);
  if (!text) return [];
  return text.split(/[|,]/).map((item) => item.trim()).filter(Boolean);
}

function parseLooseDump(raw) {
  const record = {};
  const propertyPattern = /"([^"]+)"\s*:\s*("(?:\\.|[^"])*"|true|false|null|-?\d+(?:\.\d+)?)/g;
  for (const match of raw.matchAll(propertyPattern)) {
    const [, key, value] = match;
    try {
      record[key] = JSON.parse(value);
    } catch {
      record[key] = value;
    }
  }
  return Object.keys(record).length ? [record] : [];
}

function parseJsonRecords(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.products)) return parsed.products;
  return [parsed];
}

function parseBsonDocuments(buffer) {
  const records = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) break;
    const size = buffer.readInt32LE(offset);
    if (!Number.isFinite(size) || size < 5 || offset + size > buffer.length) {
      throw new Error(`Invalid BSON document length at byte ${offset}.`);
    }
    records.push(BSON.deserialize(buffer.subarray(offset, offset + size), { promoteValues: true }));
    offset += size;
  }

  return records;
}

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

function normalizeDumpValue(value) {
  const scalar = scalarValue(value);
  if (scalar !== value) return scalar;
  if (Array.isArray(value)) return value.map(normalizeDumpValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeDumpValue(child)]));
  }
  return value;
}

function normalizeDumpRecord(record) {
  return Object.fromEntries(Object.entries(record || {}).map(([key, value]) => [key, normalizeDumpValue(value)]));
}

function readDumpRecords(dumpPath) {
  const compressed = fs.readFileSync(dumpPath);
  const buffer = dumpPath.endsWith(".gz") ? zlib.gunzipSync(compressed) : compressed;
  const extension = path.basename(dumpPath).toLowerCase();

  if (extension.endsWith(".bson") || extension.endsWith(".bson.gz")) {
    return parseBsonDocuments(buffer);
  }

  const raw = buffer.toString("utf8");
  try {
    return parseJsonRecords(raw);
  } catch {
    return parseLooseDump(raw);
  }
}

function buildProduct(record) {
  const normalizedRecord = normalizeDumpRecord(record);
  const sku = textValue(normalizedRecord._id || normalizedRecord.sku || normalizedRecord.SKU || normalizedRecord.id);
  if (!sku) return null;

  const defaultImage = textValue(normalizedRecord.default_image || normalizedRecord.defaultImage || normalizedRecord.image || normalizedRecord.image_url);
  const images = [...new Set([defaultImage, ...listValue(normalizedRecord.images || normalizedRecord.image_urls)].filter(Boolean))];
  const price = numberValue(normalizedRecord.price || normalizedRecord.sale_price || normalizedRecord.sell_price);
  const cost = numberValue(normalizedRecord.cost || normalizedRecord.fob_price || normalizedRecord.wholesale_price);
  const stockQty = numberValue(normalizedRecord.stock_qty ?? normalizedRecord.stockQty ?? normalizedRecord.qty ?? normalizedRecord.quantity);
  const minQuantity = textValue(normalizedRecord.min_quantity || normalizedRecord.minQuantity);
  const checkedImage = normalizedRecord.checked_image && typeof normalizedRecord.checked_image === "object" ? normalizedRecord.checked_image : {};

  return {
    sku,
    externalId: textValue(normalizedRecord._id || normalizedRecord.id),
    title: textValue(normalizedRecord.name || normalizedRecord.title || sku),
    marketplaceTitle: textValue(normalizedRecord.marketplaceTitle || normalizedRecord.name || normalizedRecord.title || sku),
    shortDescription: textValue(normalizedRecord.short_description || normalizedRecord.shortDescription),
    longDescription: textValue(normalizedRecord.description || normalizedRecord.long_description || normalizedRecord.longDescription),
    brand: textValue(normalizedRecord.brand),
    category: textValue(normalizedRecord.category || normalizedRecord.product_type),
    condition: textValue(normalizedRecord.condition) || "New",
    status: normalizedRecord.active === false ? "Draft" : textValue(normalizedRecord.status) || "Draft",
    active: normalizedRecord.active === undefined ? true : Boolean(normalizedRecord.active),
    barcode: textValue(normalizedRecord.upc || normalizedRecord.barcode || normalizedRecord.gtin),
    defaultImage,
    images,
    manufacturer: textValue(normalizedRecord.manufacturer),
    mfrPartNumber: textValue(normalizedRecord.mfr_part_number || normalizedRecord.mfrPartNumber),
    vendorSku: textValue(normalizedRecord.vendor_sku || normalizedRecord.vendorSku),
    supplier: textValue(normalizedRecord.supplier),
    supplierCode: textValue(normalizedRecord.supplier_code || normalizedRecord.supplierCode),
    vendor: textValue(normalizedRecord.vendor || normalizedRecord.supplier),
    unspsc: textValue(normalizedRecord.unspsc),
    uom: textValue(normalizedRecord.uom),
    uomQty: textValue(normalizedRecord.uom_qty || normalizedRecord.uomQty),
    minQuantity,
    quantityIncrements: textValue(normalizedRecord.quantity_increments || normalizedRecord.quantityIncrements),
    hazardous: normalizedRecord.hazardous === true,
    sdsUrl: textValue(normalizedRecord.sds_url || normalizedRecord.sdsUrl),
    itemHeight: numberValue(normalizedRecord.item_height || normalizedRecord.itemHeight),
    itemLength: numberValue(normalizedRecord.item_length || normalizedRecord.itemLength),
    itemWeight: numberValue(normalizedRecord.item_weight || normalizedRecord.itemWeight),
    itemWidth: numberValue(normalizedRecord.item_width || normalizedRecord.itemWidth),
    packageHeight: numberValue(normalizedRecord.package_height || normalizedRecord.packageHeight),
    packageLength: numberValue(normalizedRecord.package_length || normalizedRecord.packageLength),
    packageWeight: numberValue(normalizedRecord.package_weight || normalizedRecord.packageWeight),
    packageWidth: numberValue(normalizedRecord.package_width || normalizedRecord.packageWidth),
    qty: stockQty,
    stockQty,
    stockStatus: textValue(normalizedRecord.stock_status || normalizedRecord.stockStatus),
    stockUpdatedAt: textValue(normalizedRecord.stock_updated_at || normalizedRecord.stockUpdatedAt),
    reorderPoint: numberValue(minQuantity),
    ctechId: textValue(normalizedRecord.ctech_id || normalizedRecord.ctechId),
    ctechIdLastExport: textValue(normalizedRecord.ctech_id_last_export || normalizedRecord.ctechIdLastExport),
    fobPrice: numberValue(normalizedRecord.fob_price || normalizedRecord.fobPrice),
    price,
    cost,
    msrp: numberValue(normalizedRecord.list_price || normalizedRecord.msrp),
    wildcardSearch: textValue(normalizedRecord.wildcardSearch),
    tags: listValue(normalizedRecord.tags),
    attributes: normalizedRecord.attributes && typeof normalizedRecord.attributes === "object" ? normalizedRecord.attributes : {},
    productDumpCreatedAt: textValue(normalizedRecord.created_at || normalizedRecord.createdAt),
    productDumpUpdatedAt: textValue(normalizedRecord.updated_at || normalizedRecord.updatedAt),
    inactiveMailedAt: textValue(normalizedRecord.inactive_mailed_at || normalizedRecord.inactiveMailedAt),
    validatedAt: textValue(normalizedRecord.validated_at || normalizedRecord.validatedAt),
    checkedImage,
    checkedImageUrl: textValue(checkedImage.url),
    checkedImageError: textValue(checkedImage.error),
    checkedImageSize: textValue(checkedImage.size),
    checkedImageTimestamp: textValue(checkedImage.timestamp),
    productManagerFields: normalizedRecord,
    sources: { productDump: sku },
    importedFrom: "products.bson.gz",
    updatedAt: new Date().toISOString()
  };
}

async function readAppState() {
  const postgresState = await readState();
  if (postgresState) return { state: postgresState, write: (next) => writeState(next) };

  const fallbackPath = path.join(ROOT, "data", "db.json");
  if (!fs.existsSync(fallbackPath)) throw new Error("No PostgreSQL state or data/db.json found.");
  return {
    state: JSON.parse(fs.readFileSync(fallbackPath, "utf8")),
    write: async (next) => fs.writeFileSync(fallbackPath, JSON.stringify(next, null, 2))
  };
}

function mergeProduct(existing, product) {
  const next = { ...existing, ...product, id: existing.id || crypto.randomUUID() };
  next.sources = { ...(existing.sources || {}), ...(product.sources || {}) };
  next.images = product.images.length ? product.images : existing.images || [];
  next.tags = product.tags.length ? product.tags : existing.tags || [];
  next.shadowSkus = Array.isArray(existing.shadowSkus) ? existing.shadowSkus : [];
  next.serialUnits = Array.isArray(existing.serialUnits) ? existing.serialUnits : [];
  next.warehouseStock = Array.isArray(existing.warehouseStock) ? existing.warehouseStock : [];
  return next;
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));
  const dumpPath = path.resolve(options.source || process.env.PRODUCT_DUMP_LOCAL_PATH || DEFAULT_LOCAL_DUMP);

  if (options.downloadFtp) {
    await downloadFromFtp(dumpPath);
    console.log(`Downloaded product dump to ${path.relative(ROOT, dumpPath)}`);
  }

  if (!fs.existsSync(dumpPath)) {
    throw new Error(`Product dump not found: ${dumpPath}`);
  }

  const rawRecords = readDumpRecords(dumpPath);
  const records = options.limit > 0 ? rawRecords.slice(0, options.limit) : rawRecords;
  const products = records.map(buildProduct).filter(Boolean);

  if (options.inspect) {
    const sample = records.slice(0, Math.max(1, options.limit || 3)).map((record, index) => {
      const normalizedRecord = normalizeDumpRecord(record);
      const product = buildProduct(record);
      return {
        index,
        rawKeys: Object.keys(normalizedRecord),
        sku: product?.sku || "",
        mapped: product ? {
          sku: product.sku,
          title: product.title,
          active: product.active,
          status: product.status,
          brand: product.brand,
          category: product.category,
          price: product.price,
          cost: product.cost,
          msrp: product.msrp,
          stockQty: product.stockQty,
          vendorSku: product.vendorSku,
          supplier: product.supplier,
          supplierCode: product.supplierCode,
          manufacturer: product.manufacturer,
          mfrPartNumber: product.mfrPartNumber,
          barcode: product.barcode,
          images: product.images,
          tags: product.tags,
          productDumpCreatedAt: product.productDumpCreatedAt,
          productDumpUpdatedAt: product.productDumpUpdatedAt,
          inactiveMailedAt: product.inactiveMailedAt,
          checkedImageUrl: product.checkedImageUrl,
          validatedAt: product.validatedAt
        } : null,
        productManagerFieldCount: product ? Object.keys(product.productManagerFields || {}).length : 0
      };
    });
    console.log(JSON.stringify({ file: path.basename(dumpPath), recordsRead: rawRecords.length, inspected: sample.length, sample }, null, 2));
    return;
  }

  const { state, write } = await readAppState();

  state.inventory = Array.isArray(state.inventory) ? state.inventory : [];
  const bySku = new Map(state.inventory.map((item, index) => [String(item.sku || "").toLowerCase(), { item, index }]));
  const stats = { read: rawRecords.length, importable: products.length, created: 0, updated: 0, skipped: rawRecords.length - products.length };

  for (const product of products) {
    const key = product.sku.toLowerCase();
    const existing = bySku.get(key);
    if (existing) {
      state.inventory[existing.index] = mergeProduct(existing.item, product);
      stats.updated += 1;
    } else {
      state.inventory.push({ id: crypto.randomUUID(), ...product });
      bySku.set(key, { item: product, index: state.inventory.length - 1 });
      stats.created += 1;
    }
  }

  if (!options.dryRun) await write(state);
  console.log(`${options.dryRun ? "Dry run:" : "Imported"} ${stats.importable} products (${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped) from ${path.basename(dumpPath)}.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
