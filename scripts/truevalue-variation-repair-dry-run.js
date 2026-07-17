const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const dataplus = require("../server");

const ROOT = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
const OUTPUT_DIR = path.join(ROOT, "outputs", "shopify-variation-repair");

function loadEnv() {
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

function text(value = "") {
  return String(value ?? "").trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  return value === true || ["true", "1", "yes", "y"].includes(text(value).toLowerCase());
}

function money(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "";
}

function csvEscape(value) {
  const raw = String(value ?? "");
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function writeCsv(filePath, rows) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ].join("\n");
  fs.writeFileSync(filePath, `${csv}\n`);
}

function productFromRow(row = {}) {
  const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
  return {
    ...raw,
    productId: row.product_id,
    id: row.product_id,
    sku: row.sku,
    title: row.title,
    marketplaceTitle: row.marketplace_title,
    brand: row.brand,
    manufacturer: row.manufacturer,
    mfrPartNumber: row.mfr_part_number,
    vendorSku: row.vendor_sku,
    barcode: row.barcode,
    category: row.category,
    mainCategory: row.main_category,
    sourceCategory: row.source_category,
    supplier: row.supplier,
    supplierCode: row.supplier_code,
    active: row.active,
    toBeDiscontinued: row.to_be_discontinued,
    uom: row.uom,
    uomQty: Number(row.uom_qty || 1),
    cost: row.cost === null ? undefined : Number(row.cost),
    sourceCost: row.cost === null ? undefined : Number(row.cost),
    price: row.price === null ? undefined : Number(row.price),
    qty: row.qty === null ? undefined : Number(row.qty),
    defaultImage: row.default_image
  };
}

function statusPayload(row = {}) {
  const payload = row.status_payload && typeof row.status_payload === "object" ? row.status_payload : {};
  return {
    sku: row.status_sku || row.sku || payload.sku || "",
    shopifyId: row.shopify_id || payload.shopifyId || "",
    shopifyVariantId: row.shopify_variant_id || payload.shopifyVariantId || "",
    shopifyHandle: row.shopify_handle || payload.shopifyHandle || "",
    shopifyStatus: row.shopify_status || payload.shopifyStatus || "",
    shopifyVariantSku: payload.shopifyVariantSku || row.status_sku || row.sku || "",
    shopifyVariantTitle: payload.shopifyVariantTitle || "",
    shopifyVariantPrice: payload.shopifyVariantPrice || "",
    shopifyVariantInventoryQuantity: payload.shopifyVariantInventoryQuantity ?? ""
  };
}

function statusFor(statuses = [], sku = "") {
  const key = text(sku).toLowerCase();
  return statuses.find((row) => text(row.status_sku || row.sku).toLowerCase() === key) || null;
}

function variantByRole(variants = [], role = "") {
  return variants.find((variant) => text(variant.variantType || variant.key).toLowerCase() === role)
    || (role === "each" ? variants.find((variant) => Number(variant.uomQty || 1) === 1) : variants.find((variant) => Number(variant.uomQty || 1) > 1))
    || null;
}

function repairAction({ eachStatus, packStatus, eachVariant, packVariant }) {
  const eachId = text(eachStatus?.shopify_variant_id || eachStatus?.shopifyVariantId);
  const packId = text(packStatus?.shopify_variant_id || packStatus?.shopifyVariantId);
  if (eachId && packId && eachId === packId) {
    const actualSku = text(eachStatus?.status_payload?.shopifyVariantSku || packStatus?.status_payload?.shopifyVariantSku || eachStatus?.status_sku || packStatus?.status_sku);
    const actualLooksPack = actualSku.toLowerCase() === text(packVariant?.sku).toLowerCase();
    return actualLooksPack ? "create_each_variant_existing_pack" : "create_pack_variant_existing_each";
  }
  if (!eachId && packId) return "create_each_variant";
  if (eachId && !packId) return "create_pack_variant";
  if (!eachId && !packId) return "review_missing_shopify_product";
  return "none";
}

async function main() {
  loadEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({ connectionString: databaseUrl });
  const db = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
  const client = await pool.connect();
  try {
    const result = await client.query(`
      with tv as (
        select
          p.*,
          coalesce(p.uom_qty, nullif(p.raw->>'uomQty','')::numeric, nullif(p.raw->>'uom_qty','')::numeric, 1) as computed_uom_qty
        from products p
        where upper(coalesce(p.supplier,'')) = 'TRUE VALUE'
          and upper(coalesce(p.supplier_code,'')) = 'TRV'
          and coalesce(p.uom_qty, nullif(p.raw->>'uomQty','')::numeric, nullif(p.raw->>'uom_qty','')::numeric, 1) > 1
      )
      select
        tv.*,
        coalesce(jsonb_agg(jsonb_build_object(
          'status_sku', sps.sku,
          'shopify_id', sps.shopify_id,
          'shopify_variant_id', sps.shopify_variant_id,
          'shopify_handle', sps.shopify_handle,
          'shopify_status', sps.shopify_status,
          'shopify_published', sps.shopify_published,
          'status_payload', sps.status_payload
        )) filter (where sps.sku is not null), '[]'::jsonb) as statuses
      from tv
      left join shopify_product_statuses sps
        on lower(sps.sku) in (
          lower(tv.sku),
          lower(tv.sku || '-' || floor(tv.computed_uom_qty)::text || 'PC')
        )
      group by tv.product_id, tv.computed_uom_qty
      order by tv.sku
    `);

    const rows = [];
    const summary = new Map();
    for (const row of result.rows) {
      const product = productFromRow(row);
      product.uomQty = number(row.computed_uom_qty, product.uomQty || 1);
      const variants = dataplus.shopifyPurchaseVariants(product, db);
      const eachVariant = variantByRole(variants, "each");
      const packVariant = variantByRole(variants, "sell-unit");
      const expectedEachSku = text(eachVariant?.sku || product.sku);
      const expectedPackSku = text(packVariant?.sku || `${product.sku}-${Math.floor(product.uomQty)}PC`);
      const statuses = Array.isArray(row.statuses) ? row.statuses : [];
      const eachStatus = statusFor(statuses, expectedEachSku);
      const packStatus = statusFor(statuses, expectedPackSku);
      const action = repairAction({ eachStatus, packStatus, eachVariant, packVariant });
      const blocked = bool(product.toBeDiscontinued) && number(product.qty, 0) <= 0;
      const statusKey = action === "none" ? "complete" : action;
      summary.set(statusKey, (summary.get(statusKey) || 0) + 1);
      if (action === "none") continue;
      rows.push({
        action,
        sku: product.sku,
        title: product.title || product.marketplaceTitle || "",
        active: product.active === null || product.active === undefined ? "" : product.active,
        to_be_discontinued: product.toBeDiscontinued,
        blocked_from_push: blocked,
        uom: product.uom,
        uom_qty: product.uomQty,
        qty: product.qty ?? "",
        source_cost: product.sourceCost ?? product.cost ?? "",
        product_price: product.price ?? "",
        expected_each_sku: expectedEachSku,
        expected_each_option: eachVariant?.optionValue || "Each",
        expected_each_price: money(eachVariant?.price),
        expected_each_cost: money(eachVariant?.unitCost),
        expected_pack_sku: expectedPackSku,
        expected_pack_option: packVariant?.optionValue || "",
        expected_pack_price: money(packVariant?.price),
        expected_pack_cost: money(packVariant?.unitCost),
        each_shopify_variant_id: eachStatus?.shopify_variant_id || "",
        each_shopify_actual_sku: statusPayload(eachStatus || {}).shopifyVariantSku,
        each_shopify_price: statusPayload(eachStatus || {}).shopifyVariantPrice,
        pack_shopify_variant_id: packStatus?.shopify_variant_id || "",
        pack_shopify_actual_sku: statusPayload(packStatus || {}).shopifyVariantSku,
        pack_shopify_price: statusPayload(packStatus || {}).shopifyVariantPrice,
        shopify_product_id: eachStatus?.shopify_id || packStatus?.shopify_id || "",
        shopify_handle: eachStatus?.shopify_handle || packStatus?.shopify_handle || "",
        note: blocked ? "Blocked: discontinued and no sellable inventory." : "Dry run only. No Shopify changes were sent."
      });
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const csvPath = path.join(OUTPUT_DIR, `truevalue-variation-repair-dry-run-${stamp}.csv`);
    const jsonPath = path.join(OUTPUT_DIR, `truevalue-variation-repair-dry-run-${stamp}.json`);
    writeCsv(csvPath, rows);
    const payload = {
      generatedAt: new Date().toISOString(),
      totalTrueValueMultiUom: result.rows.length,
      repairRows: rows.length,
      summary: Object.fromEntries([...summary.entries()].sort()),
      csvPath,
      sample: rows.slice(0, 25)
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    console.log(JSON.stringify({ ...payload, jsonPath }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
