const fs = require("fs");
const path = require("path");
const https = require("https");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
loadEnv(path.join(ROOT, ".env"));

const SHOPIFY_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-04";
const GRAPHQL_PATH = `/admin/api/${encodeURIComponent(SHOPIFY_VERSION)}/graphql.json`;
const SHIPPING_METAFIELDS = {
  itemHeight: { key: "custom.item_height", type: "dimension" },
  itemLength: { key: "custom.item_length", type: "dimension" },
  itemWeight: { key: "custom.item_weight", type: "weight" },
  itemWidth: { key: "custom.item_width", type: "dimension" },
  packageHeight: { key: "custom.package_height", type: "dimension" },
  packageLength: { key: "custom.package_length", type: "dimension" },
  packageWeight: { key: "custom.package_weight", type: "weight" },
  packageWidth: { key: "custom.package_width", type: "dimension" },
  dimensionalWeight: { key: "custom.dimensional_weight", type: "number_decimal" },
  shippingMethod: { key: "custom.shipping_method", type: "list.single_line_text_field" },
  shippingClass: { key: "custom.shipping_class", type: "single_line_text_field" },
  shippingClassReason: { key: "custom.shipping_class_reason", type: "multi_line_text_field" }
};

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(String(value).replace(/[$,]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function textValue(value) {
  return String(value ?? "").trim();
}

function requestJson(options, body = "") {
  return new Promise((resolve, reject) => {
    const req = https.request({
      ...options,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": options.contentType || "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
        ...(options.headers || {})
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          return reject(new Error(`Non-JSON response (${res.statusCode}) from ${options.path}: ${text.slice(0, 500)}`));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} from ${options.path}: ${text.slice(0, 500)}`));
        }
        resolve(data);
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function shopifyToken() {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!shop || !clientId || !clientSecret) {
    if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    throw new Error("Shopify credentials are not configured.");
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  }).toString();
  const data = await requestJson({
    hostname: shop,
    path: "/admin/oauth/access_token",
    method: "POST",
    contentType: "application/x-www-form-urlencoded"
  }, body);
  if (!data.access_token) throw new Error("Shopify token response did not include access_token.");
  return data.access_token;
}

function isRetriableShopifyError(error) {
  const message = String(error?.message || error || "");
  return message.includes("\"code\":\"THROTTLED\"") || message.includes("HTTP 429") || message.includes("ECONNRESET") || message.includes("ETIMEDOUT");
}

async function graphql(query, variables = {}, token) {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const data = await requestJson({
        hostname: process.env.SHOPIFY_STORE_DOMAIN,
        path: GRAPHQL_PATH,
        method: "POST",
        headers: { "X-Shopify-Access-Token": token }
      }, JSON.stringify({ query, variables }));
      if (Array.isArray(data.errors) && data.errors.length) {
        throw new Error(`Shopify GraphQL error: ${JSON.stringify(data.errors).slice(0, 1000)}`);
      }
      return data.data || {};
    } catch (error) {
      if (!isRetriableShopifyError(error) || attempt === maxAttempts) throw error;
      const waitMs = Math.min(30000, 1000 * 2 ** (attempt - 1));
      process.stderr.write(`Shopify throttled request; retrying in ${waitMs}ms (${attempt}/${maxAttempts})\n`);
      await sleep(waitMs);
    }
  }
}

function calculateDimensionalWeight(row = {}) {
  const length = numberValue(row.packageLength);
  const width = numberValue(row.packageWidth);
  const height = numberValue(row.packageHeight);
  if (!(length > 0 && width > 0 && height > 0)) return 0;
  return Math.round(((length * width * height) / 139) * 1000) / 1000;
}

function shippingClassification(row = {}) {
  const length = numberValue(row.packageLength || row.itemLength);
  const width = numberValue(row.packageWidth || row.itemWidth);
  const height = numberValue(row.packageHeight || row.itemHeight);
  const weight = numberValue(row.packageWeight || row.itemWeight);
  const dimensionalWeight = numberValue(row.dimensionalWeight) || calculateDimensionalWeight(row);
  const sorted = [length, width, height].sort((a, b) => b - a);
  const longest = sorted[0] || 0;
  const girth = 2 * ((sorted[1] || 0) + (sorted[2] || 0));
  const lengthPlusGirth = longest + girth;
  const reasons = [];

  if (longest > 60) reasons.push(`longest side ${longest}" exceeds 60" parcel free-shipping threshold`);
  if (lengthPlusGirth > 130) reasons.push(`length plus girth ${lengthPlusGirth}" exceeds 130"`);
  if (weight >= 50) reasons.push(`package weight ${weight} lb is 50 lb or more`);
  if (dimensionalWeight >= 70) reasons.push(`dimensional weight ${dimensionalWeight} lb is 70 lb or more`);
  if (reasons.length) return { shippingClass: "ltl", shippingMethod: "LTL", reason: reasons.join("; "), dimensionalWeight };

  const oversizeReasons = [];
  if (longest > 48) oversizeReasons.push(`longest side ${longest}" exceeds 48"`);
  if (lengthPlusGirth > 105) oversizeReasons.push(`length plus girth ${lengthPlusGirth}" exceeds 105"`);
  if (dimensionalWeight >= 50) oversizeReasons.push(`dimensional weight ${dimensionalWeight} lb is 50 lb or more`);
  if (oversizeReasons.length) return { shippingClass: "oversize_parcel", shippingMethod: "Oversize Parcel", reason: oversizeReasons.join("; "), dimensionalWeight };

  return { shippingClass: "parcel", shippingMethod: "Parcel", reason: "Within parcel size and weight thresholds.", dimensionalWeight };
}

function metafieldValue(row, field, config) {
  const value = row[field];
  if (value === undefined || value === null || value === "") return "";
  if (config.type === "dimension") {
    const amount = numberValue(value);
    return amount > 0 ? JSON.stringify({ value: amount, unit: "INCHES" }) : "";
  }
  if (config.type === "weight") {
    const amount = numberValue(value);
    return amount > 0 ? JSON.stringify({ value: amount, unit: "POUNDS" }) : "";
  }
  if (config.type === "number_decimal") {
    const amount = numberValue(value);
    return amount > 0 ? String(amount) : "";
  }
  if (config.type.startsWith("list.")) {
    const values = Array.isArray(value) ? value : [String(value).trim()].filter(Boolean);
    return values.length ? JSON.stringify(values) : "";
  }
  return textValue(value);
}

function metafieldsForRow(row = {}) {
  const classification = shippingClassification(row);
  const payload = {
    ...row,
    dimensionalWeight: classification.dimensionalWeight,
    shippingMethod: classification.shippingMethod,
    shippingClass: classification.shippingClass,
    shippingClassReason: classification.reason
  };
  const metafields = [];
  for (const [field, config] of Object.entries(SHIPPING_METAFIELDS)) {
    const [namespace, key] = config.key.split(".");
    const value = metafieldValue(payload, field, config);
    if (!value) continue;
    metafields.push({ ownerId: row.shopifyId, namespace, key, type: config.type, value });
  }
  return { classification, metafields };
}

async function shippingRows(client, options = {}) {
  const skus = options.skus || [];
  const limit = options.limit || 50000;
  const params = [];
  let skuClause = "";
  if (skus.length) {
    params.push(skus);
    skuClause = `and lower(coalesce(p.sku, linked.status_sku)) = any($${params.length}::text[])`;
  }
  params.push(limit);
  const result = await client.query(`
    with linked as (
      select distinct on (coalesce(sps.shopify_id, p.raw->>'shopifyId'))
        coalesce(sps.sku, p.sku) as status_sku,
        coalesce(sps.shopify_id, p.raw->>'shopifyId') as shopify_id,
        coalesce(sps.shopify_variant_id, p.raw->>'shopifyVariantId') as shopify_variant_id,
        coalesce(regexp_replace(coalesce(sps.status_payload->>'shopifyVariantSku', sps.sku), '-[0-9]+PC$', '', 'i'), p.sku) as base_sku,
        sps.shopify_status,
        sps.shopify_published
      from shopify_product_statuses sps
      full join products p on lower(p.sku) = lower(sps.sku)
      where coalesce(sps.shopify_id, p.raw->>'shopifyId', '') <> ''
      order by coalesce(sps.shopify_id, p.raw->>'shopifyId'), coalesce(sps.sku, p.sku)
    )
    select
      p.product_id as "productId",
      p.sku,
      linked.status_sku as statusSku,
      linked.shopify_id as "shopifyId",
      linked.shopify_variant_id as "shopifyVariantId",
      linked.shopify_status as "shopifyStatus",
      linked.shopify_published as "shopifyPublished",
      p.title,
      coalesce(nullif(p.raw->>'itemLength',''), p.raw->'original'->>'item_length') as "itemLength",
      coalesce(nullif(p.raw->>'itemWidth',''), p.raw->'original'->>'item_width') as "itemWidth",
      coalesce(nullif(p.raw->>'itemHeight',''), p.raw->'original'->>'item_height') as "itemHeight",
      coalesce(nullif(p.raw->>'itemWeight',''), p.raw->'original'->>'item_weight') as "itemWeight",
      coalesce(nullif(p.raw->>'packageLength',''), p.raw->'original'->>'package_length') as "packageLength",
      coalesce(nullif(p.raw->>'packageWidth',''), p.raw->'original'->>'package_width') as "packageWidth",
      coalesce(nullif(p.raw->>'packageHeight',''), p.raw->'original'->>'package_height') as "packageHeight",
      coalesce(nullif(p.raw->>'packageWeight',''), p.raw->'original'->>'package_weight') as "packageWeight",
      coalesce(nullif(p.raw->>'dimensionalWeight',''), nullif(p.raw->>'dimensional_weight','')) as "dimensionalWeight",
      p.raw
    from linked
    join products p on lower(p.sku) = lower(linked.base_sku)
    where (
      coalesce(nullif(p.raw->>'packageLength',''), p.raw->'original'->>'package_length') is not null
      or coalesce(nullif(p.raw->>'itemLength',''), p.raw->'original'->>'item_length') is not null
    )
    ${skuClause}
    order by p.sku
    limit $${params.length}
  `, params);
  return result.rows;
}

async function setMetafields(metafields, token) {
  if (!metafields.length) return [];
  const mutation = `
    mutation DataPlusShippingMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key type value }
        userErrors { field message code }
      }
    }
  `;
  const data = await graphql(mutation, { metafields }, token);
  const result = data.metafieldsSet || {};
  const errors = result.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => `${error.field || ""} ${error.message}`.trim()).join("; "));
  return result.metafields || [];
}

async function runConcurrent(items, limit, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      await worker(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function main() {
  const apply = hasFlag("apply");
  const localOnly = hasFlag("local-only");
  const quiet = hasFlag("quiet");
  const skus = argValue("skus", "")
    .split(/[,\s]+/)
    .map((sku) => sku.trim().toLowerCase())
    .filter(Boolean);
  const skuFile = argValue("sku-file", "");
  if (skuFile) {
    for (const sku of fs.readFileSync(path.resolve(skuFile), "utf8").split(/\r?\n/)) {
      const value = sku.trim().toLowerCase();
      if (value) skus.push(value);
    }
  }
  const classFilter = new Set(argValue("classes", "")
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean));
  const limit = Math.max(1, Math.min(100000, Number(argValue("limit", "50000")) || 50000));
  const batchSize = Math.max(1, Math.min(25, Number(argValue("batch-size", "25")) || 25));
  const concurrency = Math.max(1, Math.min(16, Number(argValue("concurrency", "8")) || 8));
  const client = new Client({ connectionString: process.env.DATABASE_URL || "postgres://postgres:Brooklyn2025@localhost:5432/dataplus" });
  await client.connect();
  const rows = await shippingRows(client, { skus, limit });
  const token = apply ? await shopifyToken() : "";
  const report = [];
  const errors = [];
  const metafieldChunks = [];
  let metafieldsPrepared = 0;
  let metafieldsSet = 0;
  let productsUpdated = 0;

  for (const row of rows) {
    const { classification, metafields } = metafieldsForRow(row);
    if (classFilter.size && !classFilter.has(classification.shippingClass)) continue;
    metafieldsPrepared += metafields.length;
    report.push({
      sku: row.sku,
      shopifyId: row.shopifyId,
      shopifyStatus: row.shopifyStatus,
      shippingClass: classification.shippingClass,
      shippingMethod: classification.shippingMethod,
      reason: classification.reason,
      packageLength: row.packageLength,
      packageWidth: row.packageWidth,
      packageHeight: row.packageHeight,
      packageWeight: row.packageWeight,
      dimensionalWeight: classification.dimensionalWeight,
      metafieldsPrepared: metafields.length,
      metafieldsSet: 0,
      error: ""
    });
    if (!apply) continue;
    try {
      if (!localOnly && metafields.length) {
        for (let index = 0; index < metafields.length; index += batchSize) {
          metafieldChunks.push({ rowIndex: report.length - 1, metafields: metafields.slice(index, index + batchSize) });
        }
      }
      const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
      raw.shippingClass = classification.shippingClass;
      raw.shippingMethod = classification.shippingMethod;
      raw.shippingClassReason = classification.reason;
      raw.dimensionalWeight = classification.dimensionalWeight;
      await client.query(`
        update products
        set raw = $1::jsonb, updated_at = now()
        where product_id = $2
      `, [JSON.stringify(raw), row.productId]);
      productsUpdated += 1;
    } catch (error) {
      report[report.length - 1].error = error.message || String(error);
      errors.push({ sku: row.sku, shopifyId: row.shopifyId, error: report[report.length - 1].error });
    }
  }

  if (apply && !localOnly && metafieldChunks.length) {
    await runConcurrent(metafieldChunks, concurrency, async (chunk, index) => {
      try {
        const added = await setMetafields(chunk.metafields, token);
        const count = added.length || chunk.metafields.length;
        metafieldsSet += count;
        report[chunk.rowIndex].metafieldsSet += count;
        if ((index + 1) % 250 === 0 || index + 1 === metafieldChunks.length) {
          process.stderr.write(`Set metafield chunks ${index + 1}/${metafieldChunks.length}; fields ${metafieldsSet}/${metafieldsPrepared}\n`);
        }
      } catch (error) {
        const message = error.message || String(error);
        report[chunk.rowIndex].error = report[chunk.rowIndex].error || message;
        errors.push({ sku: report[chunk.rowIndex].sku, shopifyId: report[chunk.rowIndex].shopifyId, error: message });
      }
    });
  }

  await client.end();
  const outDir = path.join(ROOT, "outputs");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = path.join(outDir, `shopify-shipping-classification-${apply ? "apply" : "audit"}-${stamp}.csv`);
  const headers = ["sku", "shopifyId", "shopifyStatus", "shippingClass", "shippingMethod", "reason", "packageLength", "packageWidth", "packageHeight", "packageWeight", "dimensionalWeight", "metafieldsPrepared", "metafieldsSet", "error"];
  fs.writeFileSync(csvPath, [headers.join(",")].concat(report.map((row) => headers.map((key) => csvEscape(row[key])).join(","))).join("\n"));
  const summary = {
    mode: apply ? (localOnly ? "local-only" : "apply") : "dry-run",
    productsChecked: rows.length,
    productsUpdated,
    ltl: report.filter((row) => row.shippingClass === "ltl").length,
    oversizeParcel: report.filter((row) => row.shippingClass === "oversize_parcel").length,
    parcel: report.filter((row) => row.shippingClass === "parcel").length,
    metafieldsPrepared,
    metafieldsSet,
    errors: errors.length,
    csvPath
  };
  if (!quiet) {
    summary.sample = report.slice(0, 20);
    summary.errorSample = errors.slice(0, 20);
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
