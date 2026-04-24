const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readState, writeState, closePool } = require("../db");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
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
  return record;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function textValue(value) {
  return value == null ? "" : String(value).trim();
}

function buildProduct(record) {
  const sku = textValue(record.sku || record._id);
  if (!sku) throw new Error("Product dump does not contain sku or _id.");

  const defaultImage = textValue(record.default_image);
  return {
    sku,
    externalId: textValue(record._id),
    title: textValue(record.name || sku),
    marketplaceTitle: textValue(record.name || sku),
    shortDescription: textValue(record.short_description),
    longDescription: textValue(record.description),
    brand: textValue(record.brand),
    category: textValue(record.category),
    condition: "New",
    status: record.active === true ? "Live" : "Draft",
    barcode: textValue(record.upc),
    defaultImage,
    images: defaultImage ? [defaultImage] : [],
    manufacturer: textValue(record.manufacturer),
    mfrPartNumber: textValue(record.mfr_part_number),
    vendorSku: textValue(record.vendor_sku),
    supplier: textValue(record.supplier),
    supplierCode: textValue(record.supplier_code),
    vendor: textValue(record.supplier),
    unspsc: textValue(record.unspsc),
    uom: textValue(record.uom),
    uomQty: textValue(record.uom_qty),
    minQuantity: textValue(record.min_quantity),
    quantityIncrements: textValue(record.quantity_increments),
    hazardous: record.hazardous === true,
    sdsUrl: textValue(record.sds_url),
    itemHeight: numberValue(record.item_height),
    itemLength: numberValue(record.item_length),
    itemWeight: numberValue(record.item_weight),
    itemWidth: numberValue(record.item_width),
    packageHeight: numberValue(record.package_height),
    packageLength: numberValue(record.package_length),
    packageWeight: numberValue(record.package_weight),
    packageWidth: numberValue(record.package_width),
    qty: numberValue(record.stock_qty),
    reserved: 0,
    stockQty: numberValue(record.stock_qty),
    stockStatus: textValue(record.stock_status),
    stockUpdatedAt: textValue(record.stock_updated_at),
    reorderPoint: numberValue(record.min_quantity),
    ctechId: textValue(record.ctech_id),
    ctechIdLastExport: textValue(record.ctech_id_last_export),
    fobPrice: numberValue(record.fob_price),
    price: numberValue(record.price),
    cost: numberValue(record.fob_price),
    msrp: numberValue(record.list_price),
    wildcardSearch: textValue(record.wildcardSearch),
    tags: [],
    sources: { productDump: sku },
    importedFrom: "product_data.json",
    updatedAt: new Date().toISOString()
  };
}

async function readAppState() {
  const postgresState = await readState();
  if (postgresState) return { state: postgresState, write: (next) => writeState(next) };

  const fallbackPath = path.join(__dirname, "..", "data", "db.json");
  if (!fs.existsSync(fallbackPath)) throw new Error("No PostgreSQL state or data/db.json found.");
  return {
    state: JSON.parse(fs.readFileSync(fallbackPath, "utf8")),
    write: async (next) => fs.writeFileSync(fallbackPath, JSON.stringify(next, null, 2))
  };
}

async function main() {
  loadEnv();
  const dumpPath = process.argv[2];
  if (!dumpPath) throw new Error("Usage: node scripts/import-product-dump.js <product_data.json>");

  const raw = fs.readFileSync(dumpPath, "utf8");
  const record = parseLooseDump(raw);
  const product = buildProduct(record);
  const { state, write } = await readAppState();

  state.inventory = Array.isArray(state.inventory) ? state.inventory : [];
  const existing = state.inventory.find((item) => String(item.sku || "").toLowerCase() === product.sku.toLowerCase());
  if (existing) {
    Object.assign(existing, product, { id: existing.id || crypto.randomUUID() });
  } else {
    state.inventory.push({ id: crypto.randomUUID(), ...product });
  }

  await write(state);
  console.log(`${existing ? "Updated" : "Created"} SKU ${product.sku}`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
