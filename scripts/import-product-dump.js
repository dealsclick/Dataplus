const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { once } = require("events");
const { finished } = require("stream/promises");
const { BSON } = require("bson");
const ftp = require("basic-ftp");
const { readState, writeState, closePool } = require("../db");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DEFAULT_LOCAL_DUMP = path.join(ROOT, "data", "imports", "products.bson.gz");
const DEFAULT_CATALOG_PATH = path.join(ROOT, "data", "catalog", "products.ndjson");
const IMPORT_JOB_FILE_DIR = path.join(DATA_DIR, "import-jobs");
const IMPORT_ERROR_COLUMNS = ["row", "record_key", "field", "issue", "raw_value", "sku", "category", "supplier", "details"];
const DUMP_REVIEW_FIELDS = new Set([
  "barcode",
  "vendorSku",
  "mfrPartNumber",
  "uom",
  "uomQty",
  "minQuantity",
  "quantityIncrements",
  "cost",
  "price",
  "fobPrice",
  "msrp",
  "stockQty",
  "qty",
  "stockStatus",
  "countryOfOrigin",
  "supplier",
  "supplierCode"
]);
const DUMP_PROTECTED_CONTENT_FIELDS = new Set([
  "title",
  "marketplaceTitle",
  "shortDescription",
  "longDescription",
  "bulletPoints",
  "category",
  "defaultImage",
  "images",
  "tags",
  "manufacturer",
  "seoKeywords"
]);
const DUMP_SOURCE_TRACE_FIELDS = new Set([
  "sourceBrand",
  "productManagerFields",
  "productDumpCreatedAt",
  "productDumpUpdatedAt",
  "inactiveMailedAt",
  "validatedAt",
  "checkedImage",
  "checkedImageUrl",
  "checkedImageError",
  "checkedImageSize",
  "checkedImageTimestamp",
  "wildcardSearch",
  "original",
  "originalImage",
  "vendorDescription",
  "updatedAt",
  "sources",
  "importedFrom"
]);

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
    inventory: false,
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
    } else if (arg === "--inventory") {
      options.inventory = true;
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

function escapeCsv(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows = []) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");
}

function standardImportError(attrs = {}) {
  const row = {
    row: attrs.row ?? "",
    record_key: attrs.recordKey ?? attrs.key ?? attrs.sku ?? attrs.category ?? "",
    field: attrs.field || "",
    issue: attrs.issue || attrs.error || "Import issue",
    raw_value: attrs.rawValue ?? attrs.raw_value ?? "",
    sku: attrs.sku || "",
    category: attrs.category || "",
    supplier: attrs.supplier || "",
    details: attrs.details || ""
  };
  for (const [key, value] of Object.entries(attrs)) {
    if (row[key] === undefined && !["key", "error", "rawValue", "raw_value"].includes(key)) row[key] = value ?? "";
  }
  return row;
}

function orderedImportErrorRows(rows = []) {
  return rows.map((row) => {
    const normalized = standardImportError(row);
    const ordered = {};
    for (const column of IMPORT_ERROR_COLUMNS) ordered[column] = normalized[column] ?? "";
    for (const [key, value] of Object.entries(normalized)) {
      if (ordered[key] === undefined) ordered[key] = value ?? "";
    }
    return ordered;
  });
}

function importErrorMessages(rows = []) {
  return rows.map((row) => {
    const normalized = standardImportError(row);
    const target = normalized.record_key || normalized.sku || normalized.category || normalized.field;
    return `${normalized.issue}${target ? `: ${target}` : ""}${normalized.row ? ` (row ${normalized.row})` : ""}`;
  }).slice(0, 50);
}

async function writeLine(writer, line) {
  if (writer.write(line)) return;
  await Promise.race([
    once(writer, "drain"),
    once(writer, "error").then(([error]) => { throw error; })
  ]);
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

function booleanValue(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true || value === false) return value;
  const text = textValue(value).toLowerCase();
  if (["true", "1", "yes", "y"].includes(text)) return true;
  if (["false", "0", "no", "n"].includes(text)) return false;
  return fallback;
}

function dimensionalWeightValue(record) {
  const length = numberValue(record.package_length || record.packageLength);
  const width = numberValue(record.package_width || record.packageWidth);
  const height = numberValue(record.package_height || record.packageHeight);
  if (!(length > 0 && width > 0 && height > 0)) return 0;
  return Math.round(((length * width * height) / 139) * 1000) / 1000;
}

function normalizedCompareValue(value) {
  if (Array.isArray(value)) return value.map((item) => normalizedCompareValue(item)).join("|");
  if (value && typeof value === "object") return JSON.stringify(value);
  if (value === undefined || value === null) return "";
  const number = Number(value);
  if (Number.isFinite(number) && String(value).trim() !== "") return String(Number(number.toFixed(4)));
  return String(value).trim();
}

function formatBrandName(value) {
  const text = textValue(value).replace(/[\u2122\u00ae\u00a9]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const acronyms = new Set(["3M", "A/C", "AC", "ANSI", "BUNN", "CFC", "CFL", "CMM", "CNC", "CPR", "CPU", "DVI", "EPA", "GFCI", "HD", "HDMI", "HVAC", "ISO", "IT", "LED", "LLC", "LP", "MRO", "NEMA", "NSF", "OSHA", "PVC", "RFID", "UL", "UPS", "USB", "USA", "US", "UV", "VGA", "WiFi", "WIFI", "WD-40"]);
  const lowerWords = new Set(["and", "of", "the", "for", "in", "on", "to", "with"]);
  const formatPart = (part, index) => {
    if (!part) return part;
    const upper = part.toUpperCase();
    const compactUpper = upper.replace(/[^A-Z0-9]/g, "");
    if (compactUpper === "3M") return "3M";
    if (/^([A-Z]\.){2,}[A-Z]?\.?$/i.test(part)) return upper;
    if (/^[A-Z0-9]{2,4}$/.test(part)) return upper;
    if (acronyms.has(upper)) return upper === "WIFI" ? "WiFi" : upper;
    if (/^\d+[A-Z]*$/i.test(part)) return upper;
    const lower = part.toLowerCase();
    if (index > 0 && lowerWords.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };
  return text
    .split(" ")
    .map((word, wordIndex) => word
      .split("/")
      .map((slashPart) => slashPart
        .split("-")
        .map((part, partIndex) => formatPart(part, wordIndex + partIndex))
        .join("-"))
      .join("/"))
    .join(" ");
}

function formatCategoryName(value) {
  const text = textValue(value).replace(/[\u2122\u00ae\u00a9]/g, "").replace(/\s*>\s*/g, " > ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const acronyms = new Set(["3D", "A/C", "AC", "ANSI", "CFC", "CFL", "CNC", "CPR", "CPU", "DVI", "EPA", "GFCI", "HD", "HDMI", "HVAC", "ISO", "IT", "LED", "MRO", "NEMA", "NSF", "OSHA", "PPE", "PVC", "RFID", "UL", "UPS", "USB", "UV", "VGA", "VFD", "WiFi", "WIFI"]);
  const lowerWords = new Set(["and", "of", "the", "for", "in", "on", "to", "with"]);
  const formatToken = (token, index) => {
    if (!token || token === "&") return token;
    const upper = token.toUpperCase();
    if (/^([A-Z]\.){2,}[A-Z]?\.?$/i.test(token)) return upper;
    if (acronyms.has(upper)) return upper === "WIFI" ? "WiFi" : upper;
    if (/^\d+[A-Z]*$/i.test(token)) return upper;
    const lower = token.toLowerCase();
    if (index > 0 && lowerWords.has(lower)) return lower;
    if (/^[A-Z0-9]{2,4}$/.test(token)) return upper;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };
  return text
    .split(" > ")
    .map((segment) => segment
      .split(" ")
      .map((word, wordIndex) => word
        .split("/")
        .map((slashPart) => slashPart
          .split("-")
          .map((part, partIndex) => formatToken(part, wordIndex + partIndex))
          .join("-"))
        .join("/"))
      .join(" "))
    .join(" > ");
}

function isEmptyCatalogValue(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (value === undefined || value === null) return true;
  if (typeof value === "number") return value === 0;
  return String(value).trim() === "";
}

function brandLooksLikeSupplier(item = {}) {
  const brand = textValue(item.brand).toLowerCase();
  if (!brand) return true;
  return [item.supplier, item.vendor, item.defaultSupplier, item.supplierCode]
    .map((value) => textValue(value).toLowerCase())
    .filter(Boolean)
    .includes(brand);
}

function normalizeCatalogImportReviews(reviews = []) {
  return (Array.isArray(reviews) ? reviews : []).map((review) => ({
    id: review.id || crypto.randomUUID(),
    sku: textValue(review.sku),
    productId: textValue(review.productId),
    field: textValue(review.field),
    label: textValue(review.label || review.field),
    currentValue: review.currentValue ?? "",
    incomingValue: review.incomingValue ?? "",
    source: textValue(review.source || "Product dump"),
    status: textValue(review.status || "pending"),
    createdAt: review.createdAt || new Date().toISOString(),
    updatedAt: review.updatedAt || review.createdAt || new Date().toISOString(),
    decidedAt: review.decidedAt || "",
    decisionNote: review.decisionNote || ""
  })).filter((review) => review.sku && review.field).slice(0, 5000);
}

function queueCatalogImportReview(state, item, field, incomingValue, source = "Product dump") {
  const currentValue = item[field];
  if (normalizedCompareValue(currentValue) === normalizedCompareValue(incomingValue)) return false;
  state.catalogImportReviews = normalizeCatalogImportReviews(state.catalogImportReviews);
  const pending = state.catalogImportReviews.find((review) => (
    review.status === "pending"
    && review.sku.toLowerCase() === String(item.sku || "").toLowerCase()
    && review.field === field
  ));
  const now = new Date().toISOString();
  if (pending) {
    pending.productId = item.id || pending.productId;
    pending.currentValue = currentValue ?? "";
    pending.incomingValue = incomingValue ?? "";
    pending.source = source;
    pending.updatedAt = now;
    return true;
  }
  state.catalogImportReviews.unshift({
    id: crypto.randomUUID(),
    sku: item.sku || "",
    productId: item.id || "",
    field,
    label: field,
    currentValue: currentValue ?? "",
    incomingValue: incomingValue ?? "",
    source,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    decidedAt: "",
    decisionNote: ""
  });
  state.catalogImportReviews = state.catalogImportReviews.slice(0, 5000);
  return true;
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

async function readBsonDocumentsStream(dumpPath, limit = 0) {
  const records = [];
  await forEachBsonDocumentStream(dumpPath, { limit }, (record) => {
    records.push(record);
  });
  return records;
}

async function forEachBsonDocumentStream(dumpPath, options = {}, onRecord) {
  const limit = Number(options.limit || 0);
  let buffer = Buffer.alloc(0);
  const source = fs.createReadStream(dumpPath);
  const stream = dumpPath.endsWith(".gz") ? source.pipe(zlib.createGunzip()) : source;
  let count = 0;

  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && (!limit || count < limit)) {
      const size = buffer.readInt32LE(0);
      if (!Number.isFinite(size) || size < 5) {
        throw new Error(`Invalid BSON document length at record ${count}: ${size}.`);
      }
      if (buffer.length < size) break;
      const record = BSON.deserialize(buffer.subarray(0, size), { promoteValues: true });
      buffer = buffer.subarray(size);
      await onRecord(record, count);
      count += 1;
    }
    if (limit && count >= limit) {
      stream.destroy();
      break;
    }
  }

  return count;
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

async function readDumpRecordsForInspect(dumpPath, limit = 5) {
  const extension = path.basename(dumpPath).toLowerCase();
  if (extension.endsWith(".bson") || extension.endsWith(".bson.gz")) {
    return readBsonDocumentsStream(dumpPath, limit);
  }
  return readDumpRecords(dumpPath).slice(0, limit);
}

async function forEachDumpRecord(dumpPath, options = {}, onRecord) {
  const extension = path.basename(dumpPath).toLowerCase();
  if (extension.endsWith(".bson") || extension.endsWith(".bson.gz")) {
    return forEachBsonDocumentStream(dumpPath, options, onRecord);
  }

  const records = readDumpRecords(dumpPath);
  const limit = Number(options.limit || 0);
  const selected = limit > 0 ? records.slice(0, limit) : records;
  for (let index = 0; index < selected.length; index += 1) {
    await onRecord(selected[index], index);
  }
  return records.length;
}

function buildProduct(record) {
  const normalizedRecord = normalizeDumpRecord(record);
  const sku = textValue(normalizedRecord._id || normalizedRecord.sku || normalizedRecord.SKU || normalizedRecord.id);
  if (!sku) return null;

  const defaultImage = textValue(normalizedRecord.default_image || normalizedRecord.defaultImage || normalizedRecord.image || normalizedRecord.image_url);
  const images = [...new Set([defaultImage, ...listValue(normalizedRecord.images || normalizedRecord.image_urls)].filter(Boolean))];
  const sourceCost = numberValue(normalizedRecord.price || normalizedRecord.cost || normalizedRecord.fob_price || normalizedRecord.wholesale_price);
  const listPrice = numberValue(normalizedRecord.list_price || normalizedRecord.msrp);
  const websitePrice = sourceCost > 0 ? Math.round((sourceCost * 1.6) * 100) / 100 : 0;
  const stockQty = numberValue(normalizedRecord.stock_qty ?? normalizedRecord.stockQty ?? normalizedRecord.qty ?? normalizedRecord.quantity);
  const minQuantity = textValue(normalizedRecord.min_quantity || normalizedRecord.minQuantity);
  const checkedImage = normalizedRecord.checked_image && typeof normalizedRecord.checked_image === "object" ? normalizedRecord.checked_image : {};
  const sourceBrand = textValue(normalizedRecord.sourceBrand || normalizedRecord.brand);
  const sourceCategory = formatCategoryName(normalizedRecord.category || normalizedRecord.product_type);

  return {
    sku,
    externalId: textValue(normalizedRecord._id || normalizedRecord.id),
    title: textValue(normalizedRecord.name || normalizedRecord.title || sku),
    marketplaceTitle: textValue(normalizedRecord.marketplaceTitle || normalizedRecord.name || normalizedRecord.title || sku),
    shortDescription: textValue(normalizedRecord.short_description || normalizedRecord.shortDescription),
    longDescription: textValue(normalizedRecord.description || normalizedRecord.long_description || normalizedRecord.longDescription),
    bulletPoints: listValue(normalizedRecord.bullet_points || normalizedRecord.bulletPoints || normalizedRecord.keyFeatures || normalizedRecord.features),
    brand: formatBrandName(sourceBrand),
    sourceBrand,
    brandLocked: booleanValue(normalizedRecord.brandLocked, false),
    category: sourceCategory,
    sourceCategory,
    vendorCategory: sourceCategory,
    mainCategory: "",
    categoryVerified: false,
    condition: textValue(normalizedRecord.condition) || "New",
    status: normalizedRecord.active === false ? "Draft" : textValue(normalizedRecord.status) || "Draft",
    active: booleanValue(normalizedRecord.active, true),
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
    hazardous: booleanValue(normalizedRecord.hazardous, false),
    sdsUrl: textValue(normalizedRecord.sds_url || normalizedRecord.sdsUrl),
    itemHeight: numberValue(normalizedRecord.item_height || normalizedRecord.itemHeight),
    itemLength: numberValue(normalizedRecord.item_length || normalizedRecord.itemLength),
    itemWeight: numberValue(normalizedRecord.item_weight || normalizedRecord.itemWeight),
    itemWidth: numberValue(normalizedRecord.item_width || normalizedRecord.itemWidth),
    packageHeight: numberValue(normalizedRecord.package_height || normalizedRecord.packageHeight),
    packageLength: numberValue(normalizedRecord.package_length || normalizedRecord.packageLength),
    packageWeight: numberValue(normalizedRecord.package_weight || normalizedRecord.packageWeight),
    packageWidth: numberValue(normalizedRecord.package_width || normalizedRecord.packageWidth),
    dimensionalWeight: numberValue(normalizedRecord.dimensional_weight || normalizedRecord.dimensionalWeight) || dimensionalWeightValue(normalizedRecord),
    qty: stockQty,
    stockQty,
    stockStatus: textValue(normalizedRecord.stock_status || normalizedRecord.stockStatus),
    stockUpdatedAt: textValue(normalizedRecord.stock_updated_at || normalizedRecord.stockUpdatedAt),
    reorderPoint: numberValue(minQuantity),
    ctechId: textValue(normalizedRecord.ctech_id || normalizedRecord.ctechId),
    ctechIdLastExport: textValue(normalizedRecord.ctech_id_last_export || normalizedRecord.ctechIdLastExport),
    fobPrice: numberValue(normalizedRecord.fob_price || normalizedRecord.fobPrice),
    price: websitePrice,
    websitePrice,
    cost: sourceCost,
    sourceCost,
    listPrice,
    msrp: listPrice,
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
    zoroLeadtime: textValue(normalizedRecord.zoro_leadtime || normalizedRecord.zoroLeadtime),
    zoroPrice: numberValue(normalizedRecord.zoro_price || normalizedRecord.zoroPrice),
    zoroSku: textValue(normalizedRecord.zoro_sku || normalizedRecord.zoroSku),
    zoroMinimumQty: numberValue(normalizedRecord.zoro_minimum_qty || normalizedRecord.zoroMinimumQty),
    varisContractPrice: numberValue(normalizedRecord.varis_contract_price || normalizedRecord.varisContractPrice),
    varisListPrice: numberValue(normalizedRecord.varis_list_price || normalizedRecord.varisListPrice),
    varisOdManagedPrice: numberValue(normalizedRecord.varis_od_managed_price || normalizedRecord.varisOdManagedPrice),
    varisNonOdManagedPrice: numberValue(normalizedRecord.varis_non_od_managed_price || normalizedRecord.varisNonOdManagedPrice),
    varisOdPrivatePrice: numberValue(normalizedRecord.varis_od_private_price || normalizedRecord.varisOdPrivatePrice),
    varisNonOdPrivatePrice: numberValue(normalizedRecord.varis_non_od_private_price || normalizedRecord.varisNonOdPrivatePrice),
    originalImage: textValue(normalizedRecord.original_image || normalizedRecord.originalImage),
    defaultSupplier: textValue(normalizedRecord.default_supplier || normalizedRecord.defaultSupplier),
    lastPricesUpdateAt: textValue(normalizedRecord.last_prices_update_at || normalizedRecord.lastPricesUpdateAt),
    lastPricesUpdateBy: textValue(normalizedRecord.last_prices_update_by || normalizedRecord.lastPricesUpdateBy),
    leadTime: textValue(normalizedRecord.lead_time || normalizedRecord.leadTime || normalizedRecord.leadtime),
    leadtime: textValue(normalizedRecord.leadtime),
    suppliers: normalizedRecord.suppliers === undefined ? [] : normalizedRecord.suppliers,
    altVendorSku: textValue(normalizedRecord.alt_vendor_sku || normalizedRecord.altVendorSku),
    countryOfOrigin: textValue(normalizedRecord.country_of_origin || normalizedRecord.countryOfOrigin),
    originalSdsUrl: textValue(normalizedRecord.original_sds_url || normalizedRecord.originalSdsUrl),
    itemKey: textValue(normalizedRecord.item_key || normalizedRecord.itemKey),
    itemClearanceIndicator: textValue(normalizedRecord.item_clearance_indicator || normalizedRecord.itemClearanceIndicator),
    original: normalizedRecord.original === undefined ? null : normalizedRecord.original,
    vendorDescription: textValue(normalizedRecord.vendor_descripton || normalizedRecord.vendor_description || normalizedRecord.vendorDescription),
    uploadedBy: textValue(normalizedRecord.uploaded_by || normalizedRecord.uploadedBy),
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

function normalizeImportJobs(jobs = []) {
  return Array.isArray(jobs) ? jobs : [];
}

async function createDumpImportJob(attrs = {}) {
  if (attrs.dryRun) return null;
  const { state, write } = await readAppState();
  const now = new Date().toISOString();
  const job = {
    id: crypto.randomUUID(),
    section: attrs.section || "Source Catalog",
    operation: attrs.operation || "Product dump import",
    direction: "import",
    status: "running",
    fileName: attrs.fileName || "",
    originalFileName: attrs.fileName || "",
    originalFilePath: attrs.filePath || "",
    errorFileName: "",
    errorFilePath: "",
    message: attrs.message || "Import started.",
    details: "",
    totalRows: 0,
    changed: 0,
    created: 0,
    updated: 0,
    missingCount: 0,
    errors: [],
    createdAt: now,
    startedAt: now,
    finishedAt: "",
    updatedAt: now
  };
  state.importJobs = [job, ...normalizeImportJobs(state.importJobs)].slice(0, 200);
  await write(state);
  return { id: job.id, write };
}

async function finishDumpImportJob(handle, attrs = {}) {
  if (!handle?.id) return;
  const { state, write } = await readAppState();
  state.importJobs = normalizeImportJobs(state.importJobs);
  const job = state.importJobs.find((row) => row.id === handle.id);
  if (!job) return;
  const now = new Date().toISOString();
  const errorRows = Array.isArray(attrs.errorRows) ? attrs.errorRows : [];
  if (errorRows.length) {
    const dir = path.join(IMPORT_JOB_FILE_DIR, job.id);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "errors.csv");
    fs.writeFileSync(filePath, rowsToCsv(orderedImportErrorRows(errorRows)), "utf8");
    job.errorFileName = "errors.csv";
    job.errorFilePath = filePath;
  }
  delete attrs.errorRows;
  Object.assign(job, {
    ...attrs,
    status: attrs.status || "success",
    updatedAt: now,
    finishedAt: now
  });
  await write(state);
}

function mergeProduct(existing, product, state) {
  const next = { ...existing, id: existing.id || crypto.randomUUID() };
  const sourceBrand = textValue(product.sourceBrand || product.brand);
  if (sourceBrand) next.sourceBrand = sourceBrand;
  if (!next.brandLocked && next.brand && !brandLooksLikeSupplier(next)) next.brandLocked = true;
  for (const [field, incomingValue] of Object.entries(product)) {
    if (["id", "reserved", "shadowSkus", "serialUnits", "warehouseStock"].includes(field)) continue;
    if (field === "qty" && product.stockQty !== undefined) continue;
    if (field === "brand") {
      if (!next.brand || (!next.brandLocked && brandLooksLikeSupplier(next))) {
        next.brand = formatBrandName(incomingValue);
      } else if (next.brandLocked || normalizedCompareValue(next.brand) !== normalizedCompareValue(incomingValue)) {
        queueCatalogImportReview(state, next, "brand", formatBrandName(incomingValue), "Product dump");
      }
      continue;
    }
    if (field === "category") {
      const formattedCategory = formatCategoryName(incomingValue);
      if (formattedCategory) {
        next.sourceCategory = next.sourceCategory || formattedCategory;
        next.vendorCategory = next.vendorCategory || formattedCategory;
      }
      continue;
    }
    if (DUMP_SOURCE_TRACE_FIELDS.has(field)) {
      next[field] = incomingValue;
      continue;
    }
    if (DUMP_REVIEW_FIELDS.has(field)) {
      if (isEmptyCatalogValue(next[field]) && !isEmptyCatalogValue(incomingValue)) {
        next[field] = incomingValue;
      } else {
        queueCatalogImportReview(state, next, field, incomingValue, "Product dump");
      }
      continue;
    }
    if (DUMP_PROTECTED_CONTENT_FIELDS.has(field)) {
      if (isEmptyCatalogValue(next[field]) && !isEmptyCatalogValue(incomingValue)) next[field] = incomingValue;
      continue;
    }
    next[field] = incomingValue;
  }
  next.sources = { ...(existing.sources || {}), ...(product.sources || {}) };
  next.images = existing.images?.length ? existing.images : product.images || [];
  next.tags = existing.tags?.length ? existing.tags : product.tags || [];
  next.shadowSkus = Array.isArray(existing.shadowSkus) ? existing.shadowSkus : [];
  next.serialUnits = Array.isArray(existing.serialUnits) ? existing.serialUnits : [];
  next.warehouseStock = Array.isArray(existing.warehouseStock) ? existing.warehouseStock : [];
  next.updatedAt = new Date().toISOString();
  return next;
}

async function importCatalogStore(dumpPath, options) {
  const catalogPath = path.resolve(process.env.PRODUCT_CATALOG_LOCAL_PATH || DEFAULT_CATALOG_PATH);
  const tempPath = `${catalogPath}.tmp`;
  const manifestPath = `${catalogPath}.manifest.json`;
  ensureParentDir(catalogPath);

  const stats = { read: 0, importable: 0, skipped: 0 };
  const startedAt = new Date().toISOString();
  const errorRows = [];
  const job = await createDumpImportJob({
    dryRun: options.dryRun,
    section: "Source Catalog",
    operation: options.downloadFtp ? "FTP product dump import" : "Product dump import",
    fileName: path.basename(dumpPath),
    filePath: dumpPath,
    message: `Importing source catalog from ${path.basename(dumpPath)}.`
  });
  const seen = new Set();
  const writer = options.dryRun ? null : fs.createWriteStream(tempPath, { encoding: "utf8" });
  const writerFinished = writer ? finished(writer) : null;

  try {
    await forEachDumpRecord(dumpPath, { limit: options.limit }, async (record) => {
      stats.read += 1;
      const product = buildProduct(record);
      if (!product) {
        stats.skipped += 1;
        errorRows.push(standardImportError({
          row: stats.read,
          field: "sku",
          issue: "Missing SKU",
          rawValue: JSON.stringify(normalizeDumpRecord(record)).slice(0, 2000)
        }));
        return;
      }
      stats.importable += 1;
      seen.add(product.sku.toLowerCase());
      if (writer) {
        await writeLine(writer, `${JSON.stringify({ id: product.sku, ...product })}\n`);
      }
      if (stats.read % 10000 === 0) {
        process.stderr.write(`Processed ${stats.read} records (${stats.importable} catalog products, ${stats.skipped} skipped)\\r`);
      }
    });
  } catch (error) {
    await finishDumpImportJob(job, {
      status: "failed",
      message: `Product dump import failed after ${stats.read} record${stats.read === 1 ? "" : "s"}.`,
      totalRows: stats.read,
      changed: stats.importable,
      missingCount: stats.skipped,
      errors: importErrorMessages([standardImportError({ row: stats.read, issue: error.message })]),
      errorRows: [standardImportError({ row: stats.read, issue: error.message })]
    });
    throw error;
  } finally {
    if (writer) {
      writer.end();
      await writerFinished;
    }
  }

  if (stats.read >= 10000) process.stderr.write("\n");

  if (!options.dryRun) {
    fs.renameSync(tempPath, catalogPath);
    fs.writeFileSync(manifestPath, JSON.stringify({
      source: path.basename(dumpPath),
      catalogPath: path.relative(ROOT, catalogPath),
      importedAt: new Date().toISOString(),
      startedAt,
      recordsRead: stats.read,
      productCount: stats.importable,
      skipped: stats.skipped,
      uniqueSkuCount: seen.size
    }, null, 2));
  }

  await finishDumpImportJob(job, {
    status: stats.skipped ? "warning" : "success",
    message: `${options.dryRun ? "Dry run checked" : "Imported"} ${stats.importable} source catalog products from ${path.basename(dumpPath)}.`,
    totalRows: stats.read,
    changed: stats.importable,
    created: stats.importable,
    missingCount: stats.skipped,
    errors: importErrorMessages(errorRows),
    errorRows,
    details: `${seen.size} unique SKUs written to ${path.relative(ROOT, catalogPath)}.`
  });
  console.log(`${options.dryRun ? "Dry run:" : "Imported"} ${stats.importable} catalog products (${stats.skipped} skipped) from ${path.basename(dumpPath)}${options.dryRun ? "" : ` into ${path.relative(ROOT, catalogPath)}`}.`);
}

async function importInventoryState(dumpPath, options) {
  const job = await createDumpImportJob({
    dryRun: options.dryRun,
    section: "Inventory",
    operation: options.downloadFtp ? "FTP product dump inventory import" : "Product dump inventory import",
    fileName: path.basename(dumpPath),
    filePath: dumpPath,
    message: `Importing inventory products from ${path.basename(dumpPath)}.`
  });
  const { state, write } = await readAppState();

  state.inventory = Array.isArray(state.inventory) ? state.inventory : [];
  state.catalogImportReviews = normalizeCatalogImportReviews(state.catalogImportReviews);
  const bySku = new Map(state.inventory.map((item, index) => [String(item.sku || "").toLowerCase(), { item, index }]));
  const stats = { read: 0, importable: 0, created: 0, updated: 0, skipped: 0 };
  const errorRows = [];

  try {
    await forEachDumpRecord(dumpPath, { limit: options.limit }, async (record) => {
      stats.read += 1;
      const product = buildProduct(record);
      if (!product) {
        stats.skipped += 1;
        errorRows.push(standardImportError({
          row: stats.read,
          field: "sku",
          issue: "Missing SKU",
          rawValue: JSON.stringify(normalizeDumpRecord(record)).slice(0, 2000)
        }));
        return;
      }
      stats.importable += 1;
      const key = product.sku.toLowerCase();
      const existing = bySku.get(key);
      if (existing) {
        if (!options.dryRun) state.inventory[existing.index] = mergeProduct(existing.item, product, state);
        stats.updated += 1;
      } else {
        const next = { id: crypto.randomUUID(), ...product };
        if (!options.dryRun) state.inventory.push(next);
        bySku.set(key, { item: next, index: options.dryRun ? state.inventory.length : state.inventory.length - 1 });
        stats.created += 1;
      }
      if (stats.read % 10000 === 0) {
        process.stderr.write(`Processed ${stats.read} records (${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped)\\r`);
      }
    });
    if (stats.read >= 10000) process.stderr.write("\n");

    if (!options.dryRun) await write(state);
  } catch (error) {
    await finishDumpImportJob(job, {
      status: "failed",
      message: `Product dump inventory import failed after ${stats.read} record${stats.read === 1 ? "" : "s"}.`,
      totalRows: stats.read,
      changed: stats.created + stats.updated,
      created: stats.created,
      updated: stats.updated,
      missingCount: stats.skipped,
      errors: importErrorMessages([standardImportError({ row: stats.read, issue: error.message })]),
      errorRows: [standardImportError({ row: stats.read, issue: error.message })]
    });
    throw error;
  }
  await finishDumpImportJob(job, {
    status: stats.skipped ? "warning" : "success",
    message: `${options.dryRun ? "Dry run checked" : "Imported"} ${stats.importable} inventory products from ${path.basename(dumpPath)}.`,
    totalRows: stats.read,
    changed: stats.created + stats.updated,
    created: stats.created,
    updated: stats.updated,
    missingCount: stats.skipped,
    errors: importErrorMessages(errorRows),
    errorRows
  });
  console.log(`${options.dryRun ? "Dry run:" : "Imported"} ${stats.importable} inventory products (${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped) from ${path.basename(dumpPath)}.`);
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

  if (options.inspect) {
    const inspectLimit = Math.max(1, options.limit || 5);
    const records = await readDumpRecordsForInspect(dumpPath, inspectLimit);
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
          validatedAt: product.validatedAt,
          zoroSku: product.zoroSku,
          zoroPrice: product.zoroPrice,
          zoroLeadtime: product.zoroLeadtime,
          varisContractPrice: product.varisContractPrice,
          varisListPrice: product.varisListPrice,
          defaultSupplier: product.defaultSupplier,
          leadTime: product.leadTime,
          altVendorSku: product.altVendorSku,
          countryOfOrigin: product.countryOfOrigin,
          itemKey: product.itemKey,
          uploadedBy: product.uploadedBy
        } : null,
        productManagerFieldCount: product ? Object.keys(product.productManagerFields || {}).length : 0
      };
    });
    console.log(JSON.stringify({ file: path.basename(dumpPath), inspected: sample.length, sample }, null, 2));
    return;
  }

  if (options.inventory) {
    await importInventoryState(dumpPath, options);
  } else {
    await importCatalogStore(dumpPath, options);
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
