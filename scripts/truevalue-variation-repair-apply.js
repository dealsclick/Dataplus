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

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) return process.argv[index + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
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

function statusFor(statuses = [], sku = "") {
  const key = text(sku).toLowerCase();
  return statuses.find((row) => text(row.status_sku || row.sku).toLowerCase() === key) || null;
}

function statusPayload(row = {}) {
  return row.status_payload && typeof row.status_payload === "object" ? row.status_payload : {};
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
    const actualSku = text(statusPayload(eachStatus).shopifyVariantSku || statusPayload(packStatus).shopifyVariantSku || eachStatus?.status_sku || packStatus?.status_sku);
    const actualLooksPack = actualSku.toLowerCase() === text(packVariant?.sku).toLowerCase();
    return actualLooksPack ? "create_each_variant_existing_pack" : "create_pack_variant_existing_each";
  }
  if (!eachId && packId) return "create_each_variant";
  if (eachId && !packId) return "create_pack_variant";
  if (!eachId && !packId) return "review_missing_shopify_product";
  return "none";
}

function repairVariantForAction(action, eachVariant, packVariant) {
  if (action === "create_each_variant" || action === "create_each_variant_existing_pack") return eachVariant;
  if (action === "create_pack_variant" || action === "create_pack_variant_existing_each") return packVariant;
  return null;
}

function variantInput(variant = {}, optionName = "Title", item = {}) {
  const input = {
    price: money(variant.price),
    optionValues: [{ optionName: optionName || variant.optionName || "Title", name: text(variant.optionValue || "Default Title") || "Default Title" }],
    inventoryItem: {
      sku: text(variant.sku),
      tracked: true,
      requiresShipping: true
    },
    inventoryPolicy: "DENY",
    taxable: true
  };
  const cost = money(variant.unitCost);
  if (cost) input.inventoryItem.cost = cost;
  const barcode = text(item.barcode || item.upc || item.gtin);
  if (barcode) input.barcode = barcode;
  const compareAtPrice = money(variant.compareAtPrice);
  if (compareAtPrice) input.compareAtPrice = compareAtPrice;
  return input;
}

async function loadCandidates(client, db, limit, onlySku = "") {
  const params = [];
  const skuFilter = onlySku ? `and lower(p.sku) = lower($${params.push(onlySku)})` : "";
  const result = await client.query(`
    with tv as (
      select
        p.*,
        coalesce(p.uom_qty, nullif(p.raw->>'uomQty','')::numeric, nullif(p.raw->>'uom_qty','')::numeric, 1) as computed_uom_qty
      from products p
      where upper(coalesce(p.supplier,'')) = 'TRUE VALUE'
        and upper(coalesce(p.supplier_code,'')) = 'TRV'
        and coalesce(p.uom_qty, nullif(p.raw->>'uomQty','')::numeric, nullif(p.raw->>'uom_qty','')::numeric, 1) > 1
        ${skuFilter}
    )
    select
      tv.*,
      coalesce(status_matches.statuses, '[]'::jsonb) as statuses
    from tv
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'status_sku', sps.sku,
        'shopify_id', sps.shopify_id,
        'shopify_variant_id', sps.shopify_variant_id,
        'shopify_handle', sps.shopify_handle,
        'shopify_status', sps.shopify_status,
        'shopify_published', sps.shopify_published,
        'status_payload', sps.status_payload
      )) as statuses
      from shopify_product_statuses sps
      where lower(sps.sku) in (
        lower(tv.sku),
        lower(tv.sku || '-' || floor(tv.computed_uom_qty)::text || 'PC')
      )
    ) status_matches on true
    order by tv.sku
  `, params);

  const candidates = [];
  const skipped = [];
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
    const targetVariant = repairVariantForAction(action, eachVariant, packVariant);
    const shopifyProductId = text(eachStatus?.shopify_id || packStatus?.shopify_id);
    if (action === "none") continue;
    if (action === "review_missing_shopify_product") {
      skipped.push({ sku: product.sku, action, issue: "No Shopify product ID found for either expected variant SKU." });
      continue;
    }
    if (blocked) {
      skipped.push({ sku: product.sku, action, issue: "Discontinued with no sellable inventory." });
      continue;
    }
    if (!targetVariant?.sku || !shopifyProductId) {
      skipped.push({ sku: product.sku, action, issue: "Missing target variant SKU or Shopify product ID." });
      continue;
    }
    candidates.push({
      action,
      product,
      targetVariant,
      shopifyProductId,
      shopifyHandle: text(eachStatus?.shopify_handle || packStatus?.shopify_handle),
      expectedEachSku,
      expectedPackSku,
      eachStatus,
      packStatus
    });
    if (candidates.length >= limit) break;
  }
  return { candidates, skipped };
}

async function fetchShopifyProduct(productId) {
  const data = await dataplus.shopifyGraphqlRequestAuto(`
    query DataPlusVariantRepairProduct($id: ID!) {
      product(id: $id) {
        id
        title
        handle
        status
        publishedAt
        updatedAt
        onlineStoreUrl
        options { id name position }
        variants(first: 250) {
          nodes {
            id
            sku
            title
            price
            compareAtPrice
            barcode
            inventoryQuantity
          }
        }
      }
    }
  `, { id: productId }, { operation: "True Value variant repair fetch product" });
  return data.product || null;
}

async function createShopifyVariant(productId, input) {
  const data = await dataplus.shopifyGraphqlRequestAuto(`
    mutation DataPlusTrueValueVariantRepair($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        product {
          id
          title
          handle
          status
          publishedAt
          updatedAt
          onlineStoreUrl
        }
        productVariants {
          id
          sku
          title
          price
          compareAtPrice
          barcode
          inventoryQuantity
        }
        userErrors { field message }
      }
    }
  `, { productId, variants: [input] }, { operation: "True Value variant repair create variant" });
  return data.productVariantsBulkCreate || {};
}

async function main() {
  loadEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const limit = Math.max(1, Math.min(500, Number(argValue("limit", "50")) || 50));
  const onlySku = argValue("sku", "");
  const apply = hasFlag("apply");
  const pool = new Pool({ connectionString: databaseUrl });
  const db = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
  const client = await pool.connect();
  const reportRows = [];
  const statusPatch = {};
  try {
    const { candidates, skipped } = await loadCandidates(client, db, limit, onlySku);
    for (const row of skipped) reportRows.push({ ...row, result: "skipped" });
    let processed = 0;
    for (const candidate of candidates) {
      processed += 1;
      const targetSku = text(candidate.targetVariant.sku);
      const base = {
        action: candidate.action,
        sku: candidate.product.sku,
        target_sku: targetSku,
        target_option: candidate.targetVariant.optionValue,
        target_price: money(candidate.targetVariant.price),
        target_cost: money(candidate.targetVariant.unitCost),
        shopify_product_id: candidate.shopifyProductId,
        shopify_handle: candidate.shopifyHandle,
        processed
      };
      try {
        const liveProduct = await fetchShopifyProduct(candidate.shopifyProductId);
        if (!liveProduct?.id) {
          reportRows.push({ ...base, result: "error", issue: "Shopify product was not found." });
          continue;
        }
        const liveVariants = liveProduct.variants?.nodes || [];
        const existing = liveVariants.find((variant) => text(variant.sku).toLowerCase() === targetSku.toLowerCase());
        if (existing?.id) {
          const payload = dataplus.shopifyStatusPayloadFromCreatedVariant(liveProduct, existing);
          statusPatch[targetSku.toLowerCase()] = { ...payload, sku: targetSku, shopifySyncSource: "shopify-api-variant-repair-existing" };
          reportRows.push({ ...base, result: "already_exists", created_variant_id: dataplus.normalizeShopifyVariantGid(existing.id), issue: "Variant SKU already exists on Shopify." });
          continue;
        }
        const optionName = text(liveProduct.options?.[0]?.name || candidate.targetVariant.optionName || "Title");
        const input = variantInput(candidate.targetVariant, optionName, candidate.product);
        if (!apply) {
          reportRows.push({ ...base, result: "prepared", option_name: optionName, input: JSON.stringify(input) });
          continue;
        }
        const result = await createShopifyVariant(liveProduct.id, input);
        const userErrors = Array.isArray(result.userErrors) ? result.userErrors : [];
        if (userErrors.length) {
          reportRows.push({
            ...base,
            result: "shopify_rejected",
            option_name: optionName,
            issue: userErrors.map((error) => `${Array.isArray(error.field) ? error.field.join(".") : text(error.field)} ${error.message || ""}`.trim()).join("; ")
          });
          continue;
        }
        const created = (result.productVariants || []).find((variant) => text(variant.sku).toLowerCase() === targetSku.toLowerCase())
          || (result.productVariants || [])[0]
          || null;
        if (!created?.id) {
          reportRows.push({ ...base, result: "error", option_name: optionName, issue: "Shopify did not return a created variant." });
          continue;
        }
        const productForPayload = result.product || liveProduct;
        const payload = dataplus.shopifyStatusPayloadFromCreatedVariant(productForPayload, created);
        statusPatch[targetSku.toLowerCase()] = { ...payload, sku: targetSku, shopifySyncSource: "shopify-api-variant-repair" };
        reportRows.push({
          ...base,
          result: "created",
          option_name: optionName,
          created_variant_id: dataplus.normalizeShopifyVariantGid(created.id),
          created_price: created.price || ""
        });
      } catch (error) {
        reportRows.push({ ...base, result: "error", issue: error.message || String(error) });
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (apply && Object.keys(statusPatch).length) dataplus.mergeShopifyStatusMapSync(statusPatch);

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const csvPath = path.join(OUTPUT_DIR, `truevalue-variation-repair-${apply ? "apply" : "preview"}-${stamp}.csv`);
    const jsonPath = path.join(OUTPUT_DIR, `truevalue-variation-repair-${apply ? "apply" : "preview"}-${stamp}.json`);
    writeCsv(csvPath, reportRows);
    const summary = reportRows.reduce((acc, row) => {
      const key = row.result || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const payload = {
      generatedAt: new Date().toISOString(),
      apply,
      limit,
      sku: onlySku,
      candidates: candidates.length,
      summary,
      csvPath,
      jsonPath,
      sample: reportRows.slice(0, 25)
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
