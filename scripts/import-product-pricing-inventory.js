const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { BSON } = require("bson");
const { Pool } = require("pg");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DUMP_PATH = path.join(ROOT, "data", "imports", "products.bson.gz");
const SHOPIFY_PRICE_MARKUP_PERCENT = 35;

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function scalarValue(value) {
  if (value && typeof value === "object") {
    if (value.$numberDecimal !== undefined) return value.$numberDecimal;
    if (value.$date !== undefined) return scalarValue(value.$date);
    if (value._bsontype === "Decimal128" && typeof value.toString === "function") return value.toString();
    if (value._bsontype === "ObjectId" && typeof value.toString === "function") return value.toString();
  }
  return value;
}

function normalizeValue(value) {
  const scalar = scalarValue(value);
  if (scalar !== value) return scalar;
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeValue(child)]));
  }
  return value;
}

function normalizeRecord(record) {
  return Object.fromEntries(Object.entries(record || {}).map(([key, value]) => [key, normalizeValue(value)]));
}

function textValue(value) {
  const text = String(scalarValue(value) ?? "").trim();
  return text;
}

function numberValue(value) {
  const scalar = scalarValue(value);
  if (scalar === null || scalar === undefined || scalar === "") return null;
  const number = Number(scalar);
  return Number.isFinite(number) ? number : null;
}

function boolOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "active", "in-stock"].includes(text)) return true;
  if (["0", "false", "no", "n", "inactive", "out-of-stock"].includes(text)) return false;
  return null;
}

function nullableJson(value) {
  if (value === null || value === undefined || value === "") return null;
  return value;
}

function clearanceStatusValue(value) {
  return ["clearance", "clearance item", "closeout"].includes(String(value ?? "").trim().toLowerCase());
}

function clearanceIndicatorValue(value) {
  return ["clearance", "clearance item", "closeout", "y", "yes", "true", "1"].includes(String(value ?? "").trim().toLowerCase());
}

function vendorCatalogIdFor(record = {}) {
  const value = textValue(record.supplier_code || record.supplierCode || record.supplier || record.vendor || record.default_supplier || record.defaultSupplier);
  return value ? value.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "unknown-vendor";
}

function pricedFromCost(cost, markupPercent = SHOPIFY_PRICE_MARKUP_PERCENT) {
  const number = Number(cost);
  if (!(number > 0)) return null;
  return Math.round((number * (1 + markupPercent / 100)) * 100) / 100;
}

function buildRecord(rawRecord) {
  const record = normalizeRecord(rawRecord);
  const sourceSku = textValue(record._id || record.sku || record.SKU || record.id);
  if (!sourceSku) return null;
  const sourceCost = numberValue(record.price ?? record.cost ?? record.fob_price ?? record.wholesale_price);
  const status = record.active === false ? "Draft" : textValue(record.status) || "Draft";
  const itemClearanceIndicator = textValue(record.item_clearance_indicator || record.itemClearanceIndicator);
  const isClearance = clearanceStatusValue(status) || clearanceIndicatorValue(itemClearanceIndicator);
  const listPrice = isClearance ? numberValue(record.list_price ?? record.msrp) : null;
  const stockQty = numberValue(record.stock_qty ?? record.stockQty ?? record.qty ?? record.quantity);
  const minQuantity = numberValue(record.min_quantity ?? record.minQuantity ?? record.minimum_quantity);
  const toBeDiscontinued = boolOrNull(record.to_be_discontinued ?? record.toBeDiscontinued ?? record.discontinued ?? record.is_discontinued) === true;
  const vendorWebsitePrice = numberValue(record.vendor_website_price ?? record.vendorWebsitePrice);
  const price = vendorWebsitePrice > 0 ? vendorWebsitePrice : pricedFromCost(sourceCost);
  return {
    vendor_id: vendorCatalogIdFor(record),
    source_sku: sourceSku,
    internal_sku: textValue(record.sku || record.SKU || sourceSku),
    vendor_sku: textValue(record.vendor_sku || record.vendorSku),
    cost: sourceCost,
    price,
    list_price: listPrice,
    qty: stockQty,
    stock_status: textValue(record.stock_status || record.stockStatus),
    stock_updated_at: textValue(record.stock_updated_at || record.stockUpdatedAt),
    uom: textValue(record.uom),
    uom_qty: numberValue(record.uom_qty ?? record.uomQty),
    to_be_discontinued: toBeDiscontinued,
    minimum_quantity: minQuantity,
    default_price: numberValue(record.default_price),
    default_supplier_price: numberValue(record.default_supplier_price),
    default_supplier_sku: textValue(record.default_supplier_sku),
    default_lead_time: textValue(record.default_lead_time),
    vendor_website_price: vendorWebsitePrice,
    minimum_allowed_price: numberValue(record.minimum_allowed_price ?? record.minimumAllowedPrice),
    fob_price_for_zoro: numberValue(record.fob_price_for_zoro ?? record.fobPriceForZoro),
    zoro_price: numberValue(record.zoro_price ?? record.zoroPrice),
    varis_contract_price: numberValue(record.varis_contract_price ?? record.varisContractPrice),
    varis_list_price: numberValue(record.varis_list_price ?? record.varisListPrice),
    varis_od_managed_price: numberValue(record.varis_od_managed_price ?? record.varisOdManagedPrice),
    varis_non_od_managed_price: numberValue(record.varis_non_od_managed_price ?? record.varisNonOdManagedPrice),
    varis_od_private_price: numberValue(record.varis_od_private_price ?? record.varisOdPrivatePrice),
    varis_non_od_private_price: numberValue(record.varis_non_od_private_price ?? record.varisNonOdPrivatePrice),
    bulk_prices: nullableJson(record.bulk_prices ?? record.bulkPrices),
    bsc_reporting: nullableJson(record.bsc_reporting),
    bsc_reporting_updated_at: textValue(record.bsc_reporting_updated_at),
    i_by_l: nullableJson(record.i_by_l),
    max_quantity: numberValue(record.max_quantity),
    raw: {
      sourceCost,
      websitePrice: price,
      listPrice,
      stockQty,
      stockStatus: textValue(record.stock_status || record.stockStatus),
      stockUpdatedAt: textValue(record.stock_updated_at || record.stockUpdatedAt),
      minQuantity,
      default_price: record.default_price,
      default_supplier_price: record.default_supplier_price,
      default_supplier_sku: record.default_supplier_sku,
      default_lead_time: record.default_lead_time,
      vendor_website_price: record.vendor_website_price,
      minimum_allowed_price: record.minimum_allowed_price,
      bulk_prices: record.bulk_prices,
      toBeDiscontinued,
      item_clearance_indicator: record.item_clearance_indicator,
      status
    }
  };
}

async function forEachBsonDocument(dumpPath, limit, onRecord) {
  let buffer = Buffer.alloc(0);
  let count = 0;
  const source = fs.createReadStream(dumpPath);
  const stream = dumpPath.endsWith(".gz") ? source.pipe(zlib.createGunzip()) : source;
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && (!limit || count < limit)) {
      const size = buffer.readInt32LE(0);
      if (!Number.isFinite(size) || size < 5) throw new Error(`Bad BSON document size ${size} at record ${count}`);
      if (buffer.length < size) break;
      const record = BSON.deserialize(buffer.subarray(0, size), { promoteValues: true });
      buffer = buffer.subarray(size);
      count += 1;
      await onRecord(record, count);
    }
    if (limit && count >= limit) {
      stream.destroy();
      break;
    }
  }
  return count;
}

async function ensureTables(pool) {
  await pool.query(`
    create table if not exists product_dump_system_fields (
      vendor_id text not null,
      source_sku text not null,
      default_lead_time text,
      default_price numeric,
      default_supplier_price numeric,
      default_supplier_sku text,
      i_by_l jsonb,
      bsc_reporting jsonb,
      bsc_reporting_updated_at timestamptz,
      max_quantity numeric,
      minimum_quantity numeric,
      source text not null default 'system_default',
      raw jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (vendor_id, source_sku)
    )
  `);
}

async function flushBatch(pool, batch) {
  if (!batch.length) return;
  await pool.query("begin");
  try {
    await pool.query(`
      insert into vendor_catalog_items (
        vendor_id, source_sku, internal_sku, vendor_sku, cost, price, list_price,
        qty, stock_status, uom, uom_qty, to_be_discontinued, raw,
        last_seen_at, updated_at
      )
      select vendor_id, source_sku, internal_sku, vendor_sku, cost, price, list_price,
        qty, stock_status, uom, uom_qty, coalesce(to_be_discontinued, false), raw,
        now(), now()
      from jsonb_to_recordset($1::jsonb) as x(
        vendor_id text, source_sku text, internal_sku text, vendor_sku text,
        cost numeric, price numeric, list_price numeric, qty numeric,
        stock_status text, uom text, uom_qty numeric, to_be_discontinued boolean,
        raw jsonb
      )
      on conflict (vendor_id, source_sku) do update set
        internal_sku = coalesce(excluded.internal_sku, vendor_catalog_items.internal_sku),
        vendor_sku = coalesce(excluded.vendor_sku, vendor_catalog_items.vendor_sku),
        cost = excluded.cost,
        price = excluded.price,
        list_price = excluded.list_price,
        qty = excluded.qty,
        stock_status = excluded.stock_status,
        uom = coalesce(excluded.uom, vendor_catalog_items.uom),
        uom_qty = coalesce(excluded.uom_qty, vendor_catalog_items.uom_qty),
        to_be_discontinued = excluded.to_be_discontinued,
        raw = vendor_catalog_items.raw || excluded.raw,
        last_seen_at = now(),
        updated_at = now()
    `, [JSON.stringify(batch)]);

    await pool.query(`
      insert into product_dump_commercial_fields (
        vendor_id, source_sku, minimum_allowed_price, fob_price_for_zoro,
        vendor_website_price, bulk_prices, raw, updated_at
      )
      select vendor_id, source_sku, minimum_allowed_price, fob_price_for_zoro,
        vendor_website_price, bulk_prices, raw, now()
      from jsonb_to_recordset($1::jsonb) as x(
        vendor_id text, source_sku text, minimum_allowed_price numeric,
        fob_price_for_zoro numeric, vendor_website_price numeric, bulk_prices jsonb,
        raw jsonb
      )
      on conflict (vendor_id, source_sku) do update set
        minimum_allowed_price = excluded.minimum_allowed_price,
        fob_price_for_zoro = excluded.fob_price_for_zoro,
        vendor_website_price = excluded.vendor_website_price,
        bulk_prices = excluded.bulk_prices,
        raw = product_dump_commercial_fields.raw || excluded.raw,
        updated_at = now()
    `, [JSON.stringify(batch)]);

    await pool.query(`
      insert into product_dump_system_fields (
        vendor_id, source_sku, default_lead_time, default_price,
        default_supplier_price, default_supplier_sku, i_by_l, bsc_reporting,
        bsc_reporting_updated_at, max_quantity, minimum_quantity, source, raw,
        updated_at
      )
      select vendor_id, source_sku, default_lead_time, default_price,
        default_supplier_price, default_supplier_sku, i_by_l, bsc_reporting,
        nullif(bsc_reporting_updated_at, '')::timestamptz, max_quantity,
        minimum_quantity, 'system_default', raw, now()
      from jsonb_to_recordset($1::jsonb) as x(
        vendor_id text, source_sku text, default_lead_time text,
        default_price numeric, default_supplier_price numeric,
        default_supplier_sku text, i_by_l jsonb, bsc_reporting jsonb,
        bsc_reporting_updated_at text, max_quantity numeric,
        minimum_quantity numeric, raw jsonb
      )
      on conflict (vendor_id, source_sku) do update set
        default_lead_time = excluded.default_lead_time,
        default_price = excluded.default_price,
        default_supplier_price = excluded.default_supplier_price,
        default_supplier_sku = excluded.default_supplier_sku,
        i_by_l = excluded.i_by_l,
        bsc_reporting = excluded.bsc_reporting,
        bsc_reporting_updated_at = excluded.bsc_reporting_updated_at,
        max_quantity = excluded.max_quantity,
        minimum_quantity = excluded.minimum_quantity,
        source = excluded.source,
        raw = product_dump_system_fields.raw || excluded.raw,
        updated_at = now()
    `, [JSON.stringify(batch)]);
    await pool.query("commit");
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { dumpPath: DEFAULT_DUMP_PATH, limit: 0, batchSize: 5000 };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--dump") options.dumpPath = path.resolve(args[++i]);
    else if (args[i] === "--limit") options.limit = Number(args[++i] || 0);
    else if (args[i] === "--batch-size") options.batchSize = Number(args[++i] || options.batchSize);
  }
  return options;
}

async function main() {
  loadEnv();
  const options = parseArgs();
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("DATABASE_URL or POSTGRES_URL is required.");
  if (!fs.existsSync(options.dumpPath)) throw new Error(`Dump file not found: ${options.dumpPath}`);
  const pool = new Pool({ connectionString });
  const batch = [];
  const stats = { read: 0, importable: 0, skipped: 0, closeouts: 0 };
  const started = Date.now();
  try {
    await ensureTables(pool);
    await forEachBsonDocument(options.dumpPath, options.limit, async (record) => {
      stats.read += 1;
      const row = buildRecord(record);
      if (!row) {
        stats.skipped += 1;
        return;
      }
      stats.importable += 1;
      if (row.to_be_discontinued || row.list_price) stats.closeouts += 1;
      batch.push(row);
      if (batch.length >= options.batchSize) {
        await flushBatch(pool, batch.splice(0));
        process.stderr.write(`Pricing/inventory ${stats.read} records (${stats.importable} imported, ${stats.closeouts} closeout/promo)\\r`);
      }
    });
    await flushBatch(pool, batch.splice(0));
    process.stderr.write("\n");
    console.log(`Imported pricing/inventory for ${stats.importable.toLocaleString()} products (${stats.skipped.toLocaleString()} skipped, ${stats.closeouts.toLocaleString()} closeout/promo) in ${Math.round((Date.now() - started) / 1000).toLocaleString()}s.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
