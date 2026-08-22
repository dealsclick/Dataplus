const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const dataplus = require("../server");
const postgres = require("../db");

const ROOT = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
const OUTPUT_DIR = path.join(ROOT, "outputs", "shopify-min-quantity-enforcement");

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
  const parsed = Number(String(value ?? "").replace(/[$,%\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value) {
  const parsed = number(value, 0);
  return parsed > 0 ? parsed.toFixed(2) : "";
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
    supplier: row.supplier,
    supplierCode: row.supplier_code,
    active: row.active,
    toBeDiscontinued: row.to_be_discontinued,
    uom: row.uom,
    uomQty: number(row.sell_multiple || row.uom_qty || raw.uomQty || raw.uom_qty, 1),
    minQuantity: number(row.min_quantity || raw.minQuantity || raw.min_quantity || raw.original?.min_quantity, 0) || "",
    quantityIncrements: number(row.quantity_increments || raw.quantityIncrements || raw.quantity_increments || raw.original?.quantity_increments, 0) || "",
    cost: row.cost === null ? undefined : Number(row.cost),
    sourceCost: row.cost === null ? undefined : Number(row.cost),
    price: row.price === null ? undefined : Number(row.price),
    websitePrice: raw.websitePrice === undefined ? undefined : Number(raw.websitePrice),
    qty: row.qty === null ? undefined : Number(row.qty),
    defaultImage: row.default_image
  };
}

function normalizeGid(value = "", type = "ProductVariant") {
  const raw = text(value);
  if (!raw) return "";
  if (/^gid:\/\/shopify\//i.test(raw)) return raw;
  const id = raw.replace(/[^0-9]/g, "");
  return id ? `gid://shopify/${type}/${id}` : raw;
}

function variantBySku(variants = [], sku = "") {
  const key = text(sku).toLowerCase();
  return variants.find((variant) => text(variant.sku).toLowerCase() === key) || null;
}

function looksLikeEachVariant(variant = {}, baseSku = "") {
  const sku = text(variant.sku).toLowerCase();
  const title = text(variant.title).toLowerCase();
  const selected = (variant.selectedOptions || []).map((option) => text(option.value).toLowerCase());
  return sku === text(baseSku).toLowerCase()
    || title === "each"
    || title === "default title"
    || selected.includes("each")
    || selected.includes("default title");
}

function statusPayloadFromProduct(product = {}, variant = {}) {
  return dataplus.shopifyStatusPayloadFromCreatedVariant(product, variant);
}

async function loadCandidates(client, db, limit, onlySku = "", offset = 0) {
  const params = [];
  const skuFilter = onlySku ? `and lower(p.sku) = lower($${params.push(onlySku)})` : "";
  params.push(limit);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;
  const result = await client.query(`
    with product_multiples as (
      select
        p.*,
        greatest(
          coalesce(p.uom_qty, 0),
          case when coalesce(p.raw->>'uomQty', '') ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' then trim(p.raw->>'uomQty')::numeric else 0 end,
          case when coalesce(p.raw->>'uom_qty', '') ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' then trim(p.raw->>'uom_qty')::numeric else 0 end,
          case when coalesce(p.raw->>'minQuantity', '') ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' then trim(p.raw->>'minQuantity')::numeric else 0 end,
          case when coalesce(p.raw->>'min_quantity', '') ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' then trim(p.raw->>'min_quantity')::numeric else 0 end,
          case when coalesce(p.raw->'original'->>'min_quantity', '') ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' then trim(p.raw->'original'->>'min_quantity')::numeric else 0 end,
          case when coalesce(p.raw->>'quantityIncrements', '') ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' then trim(p.raw->>'quantityIncrements')::numeric else 0 end,
          case when coalesce(p.raw->>'quantity_increments', '') ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' then trim(p.raw->>'quantity_increments')::numeric else 0 end,
          case when coalesce(p.raw->'original'->>'quantity_increments', '') ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' then trim(p.raw->'original'->>'quantity_increments')::numeric else 0 end
        ) as sell_multiple,
        greatest(
          case when coalesce(p.raw->>'minQuantity', '') ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' then trim(p.raw->>'minQuantity')::numeric else 0 end,
          case when coalesce(p.raw->>'min_quantity', '') ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' then trim(p.raw->>'min_quantity')::numeric else 0 end,
          case when coalesce(p.raw->'original'->>'min_quantity', '') ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' then trim(p.raw->'original'->>'min_quantity')::numeric else 0 end
        ) as min_quantity,
        greatest(
          case when coalesce(p.raw->>'quantityIncrements', '') ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' then trim(p.raw->>'quantityIncrements')::numeric else 0 end,
          case when coalesce(p.raw->>'quantity_increments', '') ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' then trim(p.raw->>'quantity_increments')::numeric else 0 end,
          case when coalesce(p.raw->'original'->>'quantity_increments', '') ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' then trim(p.raw->'original'->>'quantity_increments')::numeric else 0 end
        ) as quantity_increments
      from products p
      where true
        ${skuFilter}
    )
    select
      pm.*,
      coalesce(nullif(pm.raw->>'shopifyId', ''), status_ids.shopify_id) as linked_shopify_id,
      coalesce(status_matches.statuses, '[]'::jsonb) as statuses
    from product_multiples pm
    left join lateral (
      select sps.shopify_id
      from shopify_product_statuses sps
      where lower(sps.sku) in (
        lower(pm.sku),
        lower(pm.sku || '-' || floor(pm.sell_multiple)::text || 'PC')
      )
        and coalesce(sps.shopify_id, '') <> ''
      order by case when lower(sps.sku) = lower(pm.sku || '-' || floor(pm.sell_multiple)::text || 'PC') then 0 else 1 end
      limit 1
    ) status_ids on true
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
        lower(pm.sku),
        lower(pm.sku || '-' || floor(pm.sell_multiple)::text || 'PC')
      )
    ) status_matches on true
    where pm.sell_multiple > 1
      and (coalesce(pm.raw->>'shopifyId', '') <> '' or coalesce(status_ids.shopify_id, '') <> '')
    order by pm.sku
    limit $${limitParam}
    offset $${offsetParam}
  `, params);

  return result.rows.map((row) => {
    const product = productFromRow(row);
    product.uomQty = Math.floor(number(row.sell_multiple, product.uomQty || 1));
    const variants = dataplus.shopifyPurchaseVariants(product, db);
    const packVariant = variants.find((variant) => number(variant.uomQty || variant.packQty, 1) > 1) || variants[0] || {};
    return {
      product,
      sellMultiple: product.uomQty,
      packVariant,
      expectedPackSku: text(packVariant.sku || `${product.sku}-${product.uomQty}PC`),
      shopifyProductId: normalizeGid(row.linked_shopify_id, "Product"),
      statuses: Array.isArray(row.statuses) ? row.statuses : []
    };
  });
}

async function fetchShopifyProduct(productId) {
  const data = await dataplus.shopifyGraphqlRequestAuto(`
    query DataPlusMinQuantityProduct($id: ID!) {
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
            selectedOptions { name value }
          }
        }
      }
    }
  `, { id: productId }, { operation: "Shopify minimum quantity enforcement fetch product" });
  return data.product || null;
}

async function setSoldMultipleMetafields(productId, multiple, packPrice) {
  const total = money(packPrice);
  const each = total ? money(number(total) / multiple) : "";
  const metafields = [
    { ownerId: productId, namespace: "custom", key: "min_quantity", type: "number_integer", value: String(multiple) },
    { ownerId: productId, namespace: "custom", key: "quantity_increments", type: "number_integer", value: String(multiple) },
    { ownerId: productId, namespace: "custom", key: "sold_in_multiples_of", type: "number_integer", value: String(multiple) },
    { ownerId: productId, namespace: "custom", key: "sold_in_multiples_message", type: "single_line_text_field", value: `Sold in multiples of ${multiple}${total ? ` for $${total}` : ""}` }
  ];
  if (each) metafields.push({ ownerId: productId, namespace: "custom", key: "each_unit_price", type: "number_decimal", value: each });
  const data = await dataplus.shopifyGraphqlRequestAuto(`
    mutation DataPlusSoldMultipleMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key type value }
        userErrors { field message }
      }
    }
  `, { metafields }, { operation: "Set Shopify sold-in-multiples metafields" });
  const result = data.metafieldsSet || {};
  const errors = Array.isArray(result.userErrors) ? result.userErrors : [];
  if (errors.length) throw new Error(errors.map((error) => `${Array.isArray(error.field) ? error.field.join(".") : ""} ${error.message || ""}`.trim()).join("; "));
  return result.metafields || [];
}

function soldMultipleMetafields(productId, multiple, packPrice) {
  const total = money(packPrice);
  const each = total ? money(number(total) / multiple) : "";
  const metafields = [
    { ownerId: productId, namespace: "custom", key: "min_quantity", type: "number_integer", value: String(multiple) },
    { ownerId: productId, namespace: "custom", key: "quantity_increments", type: "number_integer", value: String(multiple) },
    { ownerId: productId, namespace: "custom", key: "sold_in_multiples_of", type: "number_integer", value: String(multiple) },
    { ownerId: productId, namespace: "custom", key: "sold_in_multiples_message", type: "single_line_text_field", value: `Sold in multiples of ${multiple}${total ? ` for $${total}` : ""}` }
  ];
  if (each) metafields.push({ ownerId: productId, namespace: "custom", key: "each_unit_price", type: "number_decimal", value: each });
  return metafields;
}

async function setSoldMultipleMetafieldsBatch(metafields) {
  if (!metafields.length) return [];
  const data = await dataplus.shopifyGraphqlRequestAuto(`
    mutation DataPlusSoldMultipleMetafieldsBatch($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key type value }
        userErrors { field message }
      }
    }
  `, { metafields }, { operation: "Set Shopify sold-in-multiples metafields batch" });
  const result = data.metafieldsSet || {};
  const errors = Array.isArray(result.userErrors) ? result.userErrors : [];
  if (errors.length) throw new Error(errors.map((error) => `${Array.isArray(error.field) ? error.field.join(".") : ""} ${error.message || ""}`.trim()).join("; "));
  return result.metafields || [];
}

async function updateVariantToPack(productId, variantId, packVariant, optionName) {
  const input = {
    id: variantId,
    price: money(packVariant.price),
    optionValues: [{ optionName: optionName || packVariant.optionName || "Purchase Unit", name: text(packVariant.optionValue || `Pack of ${packVariant.uomQty}`) }],
    inventoryItem: {
      sku: text(packVariant.sku),
      tracked: true,
      requiresShipping: true
    },
    inventoryPolicy: "DENY",
    taxable: true
  };
  const cost = money(packVariant.unitCost);
  if (cost) input.inventoryItem.cost = cost;
  const data = await dataplus.shopifyGraphqlRequestAuto(`
    mutation DataPlusMinQuantityVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        product { id title handle status publishedAt updatedAt onlineStoreUrl }
        productVariants { id sku title price compareAtPrice barcode inventoryQuantity }
        userErrors { field message }
      }
    }
  `, { productId, variants: [input] }, { operation: "Convert Shopify each variant to sold multiple" });
  const result = data.productVariantsBulkUpdate || {};
  const errors = Array.isArray(result.userErrors) ? result.userErrors : [];
  if (errors.length) throw new Error(errors.map((error) => `${Array.isArray(error.field) ? error.field.join(".") : ""} ${error.message || ""}`.trim()).join("; "));
  return { product: result.product, variant: (result.productVariants || [])[0] || null };
}

async function deleteVariants(productId, variantIds = []) {
  const data = await dataplus.shopifyGraphqlRequestAuto(`
    mutation DataPlusMinQuantityVariantDelete($productId: ID!, $variantsIds: [ID!]!) {
      productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
        product { id title }
        userErrors { field message }
      }
    }
  `, { productId, variantsIds: variantIds }, { operation: "Delete Shopify each variants blocked by minimum quantity" });
  const result = data.productVariantsBulkDelete || {};
  const errors = Array.isArray(result.userErrors) ? result.userErrors : [];
  if (errors.length) throw new Error(errors.map((error) => `${Array.isArray(error.field) ? error.field.join(".") : ""} ${error.message || ""}`.trim()).join("; "));
  return result.product || null;
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const apply = hasFlag("apply");
  const metafieldsOnly = hasFlag("metafields-only");
  const deleteEachOnly = hasFlag("delete-each-only");
  const onlySku = argValue("sku", "");
  const limit = Math.max(1, Math.min(10000, number(argValue("limit", "1000"), 1000)));
  const offset = Math.max(0, number(argValue("offset", "0"), 0));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
  const client = await pool.connect();
  const reportRows = [];
  const statusPatch = {};
  try {
    const candidates = await loadCandidates(client, db, limit, onlySku, offset);
    let processed = 0;
    if (apply && metafieldsOnly) {
      const batchSize = 5;
      for (let index = 0; index < candidates.length; index += batchSize) {
        const batch = candidates.slice(index, index + batchSize);
        processed = Math.min(index + batch.length, candidates.length);
        process.stderr.write(`Shopify min-quantity metafields batch ${processed}/${candidates.length}${offset ? ` offset ${offset}` : ""}: ${batch[0]?.product?.sku || ""}\n`);
        try {
          await setSoldMultipleMetafieldsBatch(batch.flatMap((candidate) => soldMultipleMetafields(candidate.shopifyProductId, candidate.sellMultiple, candidate.packVariant.price)));
          for (const candidate of batch) {
            reportRows.push({
              sku: candidate.product.sku,
              title: candidate.product.title || candidate.product.marketplaceTitle || "",
              supplier: candidate.product.supplier || "",
              supplier_code: candidate.product.supplierCode || "",
              min_quantity: candidate.product.minQuantity || "",
              quantity_increments: candidate.product.quantityIncrements || "",
              sell_multiple: candidate.sellMultiple,
              expected_pack_sku: candidate.expectedPackSku,
              expected_pack_option: candidate.packVariant.optionValue || `Pack of ${candidate.sellMultiple}`,
              expected_pack_price: money(candidate.packVariant.price),
              shopify_product_id: candidate.shopifyProductId,
              processed,
              result: "applied",
              action: "metafields_only"
            });
          }
        } catch (error) {
          for (const candidate of batch) {
            reportRows.push({
              sku: candidate.product.sku,
              sell_multiple: candidate.sellMultiple,
              expected_pack_sku: candidate.expectedPackSku,
              shopify_product_id: candidate.shopifyProductId,
              processed,
              result: "error",
              action: "metafields_only",
              issue: error.message || String(error)
            });
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } else {
    for (const candidate of candidates) {
      processed += 1;
      if (processed === 1 || processed % 25 === 0 || processed === candidates.length) {
        process.stderr.write(`Shopify min-quantity ${apply ? "apply" : "preview"} ${processed}/${candidates.length}${offset ? ` offset ${offset}` : ""}: ${candidate.product.sku}\n`);
      }
      const base = {
        sku: candidate.product.sku,
        title: candidate.product.title || candidate.product.marketplaceTitle || "",
        supplier: candidate.product.supplier || "",
        supplier_code: candidate.product.supplierCode || "",
        min_quantity: candidate.product.minQuantity || "",
        quantity_increments: candidate.product.quantityIncrements || "",
        sell_multiple: candidate.sellMultiple,
        expected_pack_sku: candidate.expectedPackSku,
        expected_pack_option: candidate.packVariant.optionValue || `Pack of ${candidate.sellMultiple}`,
        expected_pack_price: money(candidate.packVariant.price),
        shopify_product_id: candidate.shopifyProductId,
        processed
      };
      try {
        if (!apply) {
          reportRows.push({ ...base, result: "prepared", action: metafieldsOnly ? "set_metafields_only" : deleteEachOnly ? "delete_each_when_pack_exists" : "inspect_live_then_set_metafields_and_remove_or_convert_each" });
          continue;
        }
        const liveProduct = await fetchShopifyProduct(candidate.shopifyProductId);
        if (!liveProduct?.id) {
          reportRows.push({ ...base, result: "error", issue: "Shopify product was not found." });
          continue;
        }
        const liveVariants = liveProduct.variants?.nodes || [];
        const pack = variantBySku(liveVariants, candidate.expectedPackSku);
        const eachVariants = liveVariants.filter((variant) => looksLikeEachVariant(variant, candidate.product.sku) && text(variant.sku).toLowerCase() !== candidate.expectedPackSku.toLowerCase());
        let action = "";
        let changedVariant = pack || null;
        if (metafieldsOnly) {
          action = "metafields_only";
        } else if (pack?.id && eachVariants.length) {
          await deleteVariants(liveProduct.id, eachVariants.map((variant) => variant.id));
          action = `deleted_${eachVariants.length}_each_variant${eachVariants.length === 1 ? "" : "s"}`;
        } else if (deleteEachOnly && !pack?.id && eachVariants.length) {
          reportRows.push({ ...base, result: "review", live_variant_count: liveVariants.length, each_variant_count: eachVariants.length, issue: "Pack variant is missing; delete-each-only mode skipped this product." });
          continue;
        } else if (!pack?.id && eachVariants.length === 1) {
          const optionName = text(liveProduct.options?.[0]?.name || candidate.packVariant.optionName || "Purchase Unit");
          const update = await updateVariantToPack(liveProduct.id, eachVariants[0].id, candidate.packVariant, optionName);
          changedVariant = update.variant;
          action = "converted_each_to_pack";
        } else if (!pack?.id && eachVariants.length > 1) {
          reportRows.push({ ...base, result: "review", live_variant_count: liveVariants.length, each_variant_count: eachVariants.length, issue: "Multiple each-like variants exist and no pack variant exists; manual review required." });
          continue;
        } else {
          action = "metafields_only";
        }
        const packPrice = changedVariant?.price || pack?.price || candidate.packVariant.price;
        await setSoldMultipleMetafields(liveProduct.id, candidate.sellMultiple, packPrice);
        if (changedVariant?.id) {
          const payload = statusPayloadFromProduct(liveProduct, changedVariant);
          statusPatch[candidate.expectedPackSku.toLowerCase()] = { ...payload, sku: candidate.expectedPackSku, shopifySyncSource: "shopify-min-quantity-enforcement" };
        }
        reportRows.push({
          ...base,
          result: "applied",
          action,
          live_variant_count: liveVariants.length,
          each_variant_count: eachVariants.length,
          pack_variant_id: dataplus.normalizeShopifyVariantGid(changedVariant?.id || pack?.id || "")
        });
      } catch (error) {
        reportRows.push({ ...base, result: "error", issue: error.message || String(error) });
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    }
    if (apply && Object.keys(statusPatch).length) {
      dataplus.mergeShopifyStatusMapSync(statusPatch);
      await postgres.upsertShopifyStatusMap(statusPatch);
    }
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const csvPath = path.join(OUTPUT_DIR, `shopify-min-quantity-enforcement-${apply ? "apply" : "preview"}-${stamp}.csv`);
    const jsonPath = path.join(OUTPUT_DIR, `shopify-min-quantity-enforcement-${apply ? "apply" : "preview"}-${stamp}.json`);
    writeCsv(csvPath, reportRows);
    const summary = reportRows.reduce((acc, row) => {
      const key = `${row.result || "unknown"}:${row.action || "none"}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const payload = {
      generatedAt: new Date().toISOString(),
      apply,
      metafieldsOnly,
      deleteEachOnly,
      limit,
      offset,
      sku: onlySku,
      candidates: reportRows.length,
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
