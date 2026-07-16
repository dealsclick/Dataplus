const fs = require("fs");
const path = require("path");
const https = require("https");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
loadEnv(path.join(ROOT, ".env"));

const SHOPIFY_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-04";
const GRAPHQL_PATH = `/admin/api/${encodeURIComponent(SHOPIFY_VERSION)}/graphql.json`;
const RISK_TAGS = {
  ltl: ["shipping-ltl", "freight-required"],
  oversize_parcel: ["shipping-oversize-parcel", "oversize-parcel"],
  parcel: ["shipping-parcel", "ground-eligible"]
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
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString();
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

async function shopifyRows(client, classes, limit, skus = []) {
  const params = [classes, limit];
  let skuClause = "";
  if (skus.length) {
    params.push(skus.map((sku) => sku.toLowerCase()));
    skuClause = `and lower(p.sku) = any($${params.length}::text[])`;
  }
  const result = await client.query(`
    with linked as (
      select distinct on (coalesce(sps.shopify_id, p.raw->>'shopifyId'))
        coalesce(sps.shopify_id, p.raw->>'shopifyId') as shopify_id,
        coalesce(regexp_replace(coalesce(sps.status_payload->>'shopifyVariantSku', sps.sku), '-[0-9]+PC$', '', 'i'), p.sku) as base_sku
      from shopify_product_statuses sps
      full join products p on lower(p.sku) = lower(sps.sku)
      where coalesce(sps.shopify_id, p.raw->>'shopifyId', '') <> ''
      order by coalesce(sps.shopify_id, p.raw->>'shopifyId'), coalesce(sps.sku, p.sku)
    )
    select distinct on (linked.shopify_id)
      p.sku,
      linked.shopify_id as "shopifyId",
      coalesce(p.raw->>'shippingClass', '') as "shippingClass",
      coalesce(p.raw->>'shippingClassReason', '') as "shippingClassReason"
    from linked
    join products p on lower(p.sku) = lower(linked.base_sku)
    where coalesce(linked.shopify_id, '') <> ''
      and coalesce(p.raw->>'shippingClass', '') = any($1::text[])
      ${skuClause}
    order by linked.shopify_id, p.sku
    limit $2
  `, params);
  return result.rows;
}

async function addTags(productId, tags, token) {
  const mutation = `
    mutation DataPlusShippingTagsAdd($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node { id }
        userErrors { field message }
      }
    }
  `;
  const data = await graphql(mutation, { id: productId, tags }, token);
  const errors = data.tagsAdd?.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => `${error.field || ""} ${error.message}`.trim()).join("; "));
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
  const classFilter = argValue("classes", "ltl,oversize_parcel")
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => RISK_TAGS[value]);
  const skus = argValue("skus", "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const limit = Math.max(1, Math.min(100000, Number(argValue("limit", "100000")) || 100000));
  const concurrency = Math.max(1, Math.min(8, Number(argValue("concurrency", "2")) || 2));
  const client = new Client({ connectionString: process.env.DATABASE_URL || "postgres://postgres:Brooklyn2025@localhost:5432/dataplus" });
  await client.connect();
  const rows = await shopifyRows(client, classFilter, limit, skus);
  await client.end();
  const token = apply ? await shopifyToken() : "";
  const report = rows.map((row) => ({
    sku: row.sku,
    shopifyId: row.shopifyId,
    shippingClass: row.shippingClass,
    tags: RISK_TAGS[row.shippingClass]?.join("|") || "",
    error: ""
  }));
  let tagsApplied = 0;
  const errors = [];
  if (apply) {
    await runConcurrent(report, concurrency, async (row, index) => {
      const tags = row.tags.split("|").filter(Boolean);
      try {
        await addTags(row.shopifyId, tags, token);
        tagsApplied += tags.length;
      } catch (error) {
        row.error = error.message || String(error);
        errors.push({ sku: row.sku, shopifyId: row.shopifyId, error: row.error });
      }
      if ((index + 1) % 100 === 0 || index + 1 === report.length) {
        process.stderr.write(`Tagged ${index + 1}/${report.length}; tags applied ${tagsApplied}; errors ${errors.length}\n`);
      }
    });
  }
  const outDir = path.join(ROOT, "outputs");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = path.join(outDir, `shopify-shipping-tags-${apply ? "apply" : "audit"}-${stamp}.csv`);
  const headers = ["sku", "shopifyId", "shippingClass", "tags", "error"];
  fs.writeFileSync(csvPath, [headers.join(",")].concat(report.map((row) => headers.map((key) => csvEscape(row[key])).join(","))).join("\n"));
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    productsPrepared: report.length,
    ltl: report.filter((row) => row.shippingClass === "ltl").length,
    oversizeParcel: report.filter((row) => row.shippingClass === "oversize_parcel").length,
    parcel: report.filter((row) => row.shippingClass === "parcel").length,
    tagsApplied,
    errors: errors.length,
    csvPath,
    errorSample: errors.slice(0, 20)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
