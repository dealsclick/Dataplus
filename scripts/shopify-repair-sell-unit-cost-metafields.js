const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const dataplus = require("../server");

const ROOT = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
const OUTPUT_DIR = path.join(ROOT, "outputs", "shopify-metafield-repair");

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

function moneyMetafieldValue(value, currencyCode = "USD") {
  const parsed = number(value, NaN);
  if (!Number.isFinite(parsed) || parsed < 0) return "";
  return JSON.stringify({
    amount: parsed.toFixed(2),
    currency_code: String(currencyCode || "USD").trim().toUpperCase()
  });
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
    uomQty: Number(row.uom_qty || raw.uomQty || raw.uom_qty || 1),
    cost: row.source_cost === null || row.source_cost === undefined ? (row.cost === null ? undefined : Number(row.cost)) : Number(row.source_cost),
    sourceCost: row.source_cost === null || row.source_cost === undefined ? (row.cost === null ? undefined : Number(row.cost)) : Number(row.source_cost),
    price: row.price === null ? undefined : Number(row.price),
    qty: row.qty === null ? undefined : Number(row.qty),
    vendorWebsitePrice: row.vendor_website_price === null ? undefined : Number(row.vendor_website_price)
  };
}

function statusPayload(row = {}) {
  return row.status_payload && typeof row.status_payload === "object" ? row.status_payload : {};
}

function statusSku(row = {}) {
  return text(row.status_sku || row.sku || statusPayload(row).shopifyVariantSku);
}

function variantForStatus(variants = [], row = {}) {
  const sku = statusSku(row).toLowerCase();
  if (sku) {
    const match = variants.find((variant) => text(variant.shopifyVariantSku || variant.sku).toLowerCase() === sku);
    if (match) return match;
  }
  const variantId = text(row.shopify_variant_id || statusPayload(row).shopifyVariantId).toLowerCase();
  if (variantId) {
    const match = variants.find((variant) => text(variant.shopifyVariantId).toLowerCase() === variantId);
    if (match) return match;
  }
  return variants.length === 1 ? variants[0] : null;
}

function sellUnitCostForStatus(product = {}, status = {}) {
  const sku = statusSku(status);
  const unitCost = number(product.cost ?? product.sourceCost, 0);
  if (!(unitCost > 0)) return 0;
  const packQty = Number(sku.match(/-(\d+)PC$/i)?.[1] || 1);
  return Math.round(unitCost * Math.max(1, packQty) * 10000) / 10000;
}

async function loadLinkedProducts(client, limit, onlySku = "") {
  const params = [];
  const skuFilter = onlySku ? `and lower(regexp_replace(coalesce(sps.status_payload->>'shopifyVariantSku', sps.sku, ''), '-[0-9]+PC$', '', 'i')) = lower($${params.push(onlySku)})` : "";
  const result = await client.query(`
    with linked as (
      select
        regexp_replace(coalesce(sps.status_payload->>'shopifyVariantSku', sps.sku, ''), '-[0-9]+PC$', '', 'i') as base_sku,
        jsonb_build_object(
          'sku', sps.sku,
          'status_sku', sps.sku,
          'shopify_id', sps.shopify_id,
          'shopify_variant_id', sps.shopify_variant_id,
          'shopify_handle', sps.shopify_handle,
          'shopify_status', sps.shopify_status,
          'status_payload', sps.status_payload
        ) as status_row
      from shopify_product_statuses sps
      where coalesce(sps.shopify_variant_id, '') <> ''
        and coalesce(sps.status_payload->>'shopifyVariantSku', sps.sku, '') <> ''
        ${skuFilter}
      order by sps.sku
      limit $${params.push(limit)}
    ),
    grouped as (
      select
        linked.base_sku,
        jsonb_agg(linked.status_row order by linked.status_row->>'status_sku') as statuses
      from linked
      group by linked.base_sku
    )
    select
      p.*,
      commercial.vendor_website_price,
      coalesce(
        vendor_catalog.cost,
        case when commercial.raw->>'cost' ~ '^[0-9]+(\\.[0-9]+)?$' then (commercial.raw->>'cost')::numeric else null end,
        case when commercial.raw->>'sourceCost' ~ '^[0-9]+(\\.[0-9]+)?$' then (commercial.raw->>'sourceCost')::numeric else null end,
        case when p.raw->>'sourceCost' ~ '^[0-9]+(\\.[0-9]+)?$' then (p.raw->>'sourceCost')::numeric else null end,
        case when p.raw->>'cost' ~ '^[0-9]+(\\.[0-9]+)?$' then (p.raw->>'cost')::numeric else null end
      ) as source_cost,
      grouped.statuses
    from grouped
    join products p on lower(p.sku) = lower(grouped.base_sku)
    left join product_dump_commercial_fields commercial on lower(commercial.source_sku) = lower(p.sku)
    left join vendor_catalog_items vendor_catalog on lower(vendor_catalog.source_sku) = lower(p.sku)
    order by p.sku
  `, params);
  return result.rows;
}

async function loadLinkedProductsLegacy(client, limit, onlySku = "") {
  const params = [];
  const skuFilter = onlySku ? `and lower(p.sku) = lower($${params.push(onlySku)})` : "";
  const result = await client.query(`
    select
      p.*,
      commercial.vendor_website_price,
      coalesce(
        vendor_catalog.cost,
        case when commercial.raw->>'cost' ~ '^[0-9]+(\\.[0-9]+)?$' then (commercial.raw->>'cost')::numeric else null end,
        case when commercial.raw->>'sourceCost' ~ '^[0-9]+(\\.[0-9]+)?$' then (commercial.raw->>'sourceCost')::numeric else null end,
        case when p.raw->>'sourceCost' ~ '^[0-9]+(\\.[0-9]+)?$' then (p.raw->>'sourceCost')::numeric else null end,
        case when p.raw->>'cost' ~ '^[0-9]+(\\.[0-9]+)?$' then (p.raw->>'cost')::numeric else null end
      ) as source_cost,
      coalesce(status_matches.statuses, '[]'::jsonb) as statuses
    from products p
    left join product_dump_commercial_fields commercial on lower(commercial.source_sku) = lower(p.sku)
    left join vendor_catalog_items vendor_catalog on lower(vendor_catalog.source_sku) = lower(p.sku)
    join lateral (
      select jsonb_agg(jsonb_build_object(
        'sku', sps.sku,
        'status_sku', sps.sku,
        'shopify_id', sps.shopify_id,
        'shopify_variant_id', sps.shopify_variant_id,
        'shopify_handle', sps.shopify_handle,
        'shopify_status', sps.shopify_status,
        'status_payload', sps.status_payload
      ) order by sps.sku) as statuses
      from shopify_product_statuses sps
      where coalesce(sps.shopify_variant_id, '') <> ''
        and (
          sps.product_id = p.product_id
          or lower(regexp_replace(coalesce(sps.sku, sps.status_payload->>'shopifyVariantSku', ''), '-[0-9]+PC$', '', 'i')) = lower(p.sku)
        )
    ) status_matches on true
    where coalesce(status_matches.statuses, '[]'::jsonb) <> '[]'::jsonb
      ${skuFilter}
    order by p.sku
    limit $${params.push(limit)}
  `, params);
  return result.rows;
}

async function setMetafields(inputs) {
  const data = await dataplus.shopifyGraphqlRequestAuto(`
    mutation DataPlusSellUnitCostMoneyRepair($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key type value owner { ... on ProductVariant { id sku } } }
        userErrors { field message code }
      }
    }
  `, { metafields: inputs }, { operation: "Repair sell unit cost money metafields" });
  const result = data.metafieldsSet || {};
  const errors = Array.isArray(result.userErrors) ? result.userErrors : [];
  if (errors.length) throw new Error(errors.map((error) => `${Array.isArray(error.field) ? error.field.join(".") : ""} ${error.message || error.code || "error"}`.trim()).join("; "));
  return result.metafields || [];
}

async function deleteSellUnitCostMetafields(ownerIds = []) {
  if (!ownerIds.length) return [];
  const data = await dataplus.shopifyGraphqlRequestAuto(`
    mutation DataPlusSellUnitCostMoneyDelete($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        deletedMetafields { ownerId namespace key }
        userErrors { field message }
      }
    }
  `, {
    metafields: ownerIds.map((ownerId) => ({ ownerId, namespace: "custom", key: "sell_unit_cost" }))
  }, { operation: "Delete stale sell unit cost metafields" });
  const result = data.metafieldsDelete || {};
  const errors = Array.isArray(result.userErrors) ? result.userErrors : [];
  if (errors.length) throw new Error(errors.map((error) => `${Array.isArray(error.field) ? error.field.join(".") : ""} ${error.message || "error"}`.trim()).join("; "));
  return result.deletedMetafields || [];
}

async function loadVariantMetafieldState(ids = []) {
  const state = new Map();
  for (let i = 0; i < ids.length; i += 250) {
    const chunk = ids.slice(i, i + 250);
    const data = await dataplus.shopifyGraphqlRequestAuto(`
      query DataPlusSellUnitCostOwnerCheck($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            metafield(namespace: "custom", key: "sell_unit_cost") {
              id
              type
              value
            }
          }
        }
      }
    `, { ids: chunk }, { operation: "Check sell unit cost variant owners" });
    for (const node of data.nodes || []) {
      if (node?.id) {
        state.set(node.id, {
          exists: true,
          metafieldId: node.metafield?.id || "",
          type: node.metafield?.type || "",
          value: node.metafield?.value || ""
        });
      }
    }
  }
  return state;
}

async function main() {
  loadEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const apply = hasFlag("apply");
  const onlyWrongType = hasFlag("only-wrong-type");
  const limit = Math.max(1, Math.min(100000, Number(argValue("limit", "10000")) || 10000));
  const onlySku = argValue("sku", "");
  const batchSize = Math.max(1, Math.min(25, Number(argValue("batch-size", "25")) || 25));
  const concurrency = Math.max(1, Math.min(8, Number(argValue("concurrency", "4")) || 4));
  const db = { connections: [], systemSettings: {} };
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  const report = [];
  let prepared = 0;
  let applied = 0;
  let errors = 0;
  try {
    const rows = await loadLinkedProducts(client, limit, onlySku);
    const inputs = [];
    for (const row of rows) {
      const product = productFromRow(row);
      const variants = dataplus.shopifyPurchaseVariants(product, db);
      const statuses = Array.isArray(row.statuses) ? row.statuses : [];
      for (const status of statuses) {
        const ownerId = dataplus.normalizeShopifyVariantGid(status.shopify_variant_id || statusPayload(status).shopifyVariantId);
        const variant = variantForStatus(variants, status);
        const sellUnitCost = sellUnitCostForStatus(product, status) || variant?.unitCost || 0;
        const value = moneyMetafieldValue(sellUnitCost);
        if (!ownerId || !value) {
          report.push({
            sku: product.sku,
            variant_sku: statusSku(status),
            shopify_variant_id: ownerId,
            result: "skipped",
            issue: !ownerId ? "Missing Shopify variant ID" : "Missing sell-unit cost"
          });
          continue;
        }
        const reportIndex = report.length;
        inputs.push({ reportIndex, input: { ownerId, namespace: "custom", key: "sell_unit_cost", type: "money", value } });
        report.push({
          sku: product.sku,
          variant_sku: statusSku(status),
          shopify_variant_id: ownerId,
          sell_unit_cost: sellUnitCost,
          metafield_value: value,
          result: apply ? "pending" : "prepared"
        });
        prepared += 1;
      }
    }
    if (apply) {
      const variantState = await loadVariantMetafieldState([...new Set(inputs.map((row) => row.input.ownerId))]);
      const liveInputs = [];
      for (const row of inputs) {
        const state = variantState.get(row.input.ownerId);
        if (state?.exists && (!onlyWrongType || (state.type && state.type !== "money"))) {
          liveInputs.push(row);
        } else if (!state?.exists && report[row.reportIndex]) {
          report[row.reportIndex].result = "error";
          report[row.reportIndex].issue = "Shopify variant owner does not exist.";
          errors += 1;
        } else if (report[row.reportIndex]) {
          report[row.reportIndex].result = "skipped";
          report[row.reportIndex].issue = state?.type === "money"
            ? "Already uses Shopify Money metafield type."
            : "No existing sell-unit-cost metafield to repair.";
        }
      }
      const batches = [];
      for (let i = 0; i < liveInputs.length; i += batchSize) batches.push(liveInputs.slice(i, i + batchSize));
      let completed = 0;
      let nextBatchIndex = 0;
      async function applyNextBatch() {
        while (nextBatchIndex < batches.length) {
          const batchIndex = nextBatchIndex;
          nextBatchIndex += 1;
          const batch = batches[batchIndex];
        try {
          await deleteSellUnitCostMetafields([...new Set(batch.map((row) => row.input.ownerId))]);
          await setMetafields(batch.map((row) => row.input));
          applied += batch.length;
          for (const row of batch) if (report[row.reportIndex]) report[row.reportIndex].result = "applied";
        } catch (error) {
          errors += batch.length;
          for (const row of batch) {
            if (report[row.reportIndex]) {
              report[row.reportIndex].result = "error";
              report[row.reportIndex].issue = error.message || String(error);
            }
          }
        }
          completed += batch.length;
          process.stderr.write(`Applied ${Math.min(completed, liveInputs.length)}/${liveInputs.length}; skipped stale ${inputs.length - liveInputs.length}\r`);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, () => applyNextBatch()));
    }
  } finally {
    client.release();
    await pool.end();
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(OUTPUT_DIR, `sell-unit-cost-money-${apply ? "apply" : "dry-run"}-${stamp}.csv`);
  writeCsv(reportPath, report);
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    prepared,
    applied,
    errors,
    reportPath
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
