const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { Pool } = require("pg");

const ROOT = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
const OUTPUT_DIR = path.join(ROOT, "outputs", "shopify-inventory");

function loadLocalEnv() {
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
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) return process.argv[index + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function numberValue(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function booleanValue(value) {
  return value === true || ["true", "yes", "y", "1"].includes(String(value ?? "").trim().toLowerCase());
}

function textValue(value = "") {
  return String(value ?? "").trim();
}

function normalizeGid(value = "", type = "") {
  const text = textValue(value);
  if (!text) return "";
  if (text.startsWith("gid://")) return text;
  const id = text.match(/(\d+)$/)?.[1] || "";
  return id && type ? `gid://shopify/${type}/${id}` : text;
}

function productUomQty(item = {}) {
  const qty = numberValue(item.uom_qty ?? item.uomQty ?? item.minQuantity ?? item.quantityIncrements, 1);
  return qty > 1 ? Math.floor(qty) : 1;
}

function variantSku(baseSku = "", suffix = "EA") {
  const sku = textValue(baseSku);
  return sku && !sku.toUpperCase().endsWith(`-${suffix}`) ? `${sku}-${suffix}` : sku;
}

function baseSkuCandidates(item = {}) {
  return [...new Set([item.sku, item.vendor_sku, item.vendorSku, item.mfr_part_number, item.mfrPartNumber]
    .map(textValue)
    .filter(Boolean))];
}

function parseShopifyPackVariantSku(sku = "", bases = []) {
  const text = textValue(sku);
  if (!text) return null;
  for (const base of bases) {
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`^${escaped}-(\\d+)PC$`, "i"));
    if (match) {
      const qty = Math.floor(numberValue(match[1], 0));
      if (qty > 1) return { baseSku: base, uomQty: qty };
    }
  }
  return null;
}

function expectedVariantQuantities(item = {}, options = {}) {
  const baseSku = baseSkuCandidates(item)[0] || "";
  const replenishableQty = booleanValue(item.replenishable) && !booleanValue(item.replenishable_use_vendor_rules) && !booleanValue(item.replenishable_qty_use_vendor_default)
    ? Math.max(0, Math.floor(numberValue(item.replenishable_qty, 0)))
    : 0;
  const stock = Math.max(0, Math.floor(numberValue(item.source_qty ?? item.qty, 0)));
  const reserved = Math.max(0, Math.floor(numberValue(item.reserved, 0)));
  const availableEach = replenishableQty > 0 ? replenishableQty : Math.max(0, stock - reserved);
  const uomQty = productUomQty(item);
  if (!baseSku) return [];
  if (uomQty <= 1) return [{ sku: baseSku, quantity: availableEach, role: "each", uomQty: 1 }];
  const packQuantity = options.packMode === "divide" ? Math.floor(availableEach / uomQty) : availableEach;
  return [
    { sku: variantSku(baseSku, `${uomQty}PC`), quantity: packQuantity, role: "pack", uomQty },
    { sku: baseSku, quantity: availableEach, role: "each", uomQty: 1 }
  ];
}

function expectedVariantQuantitiesForShopify(item = {}, variants = [], options = {}) {
  const bases = baseSkuCandidates(item);
  const replenishableQty = booleanValue(item.replenishable) && !booleanValue(item.replenishable_use_vendor_rules) && !booleanValue(item.replenishable_qty_use_vendor_default)
    ? Math.max(0, Math.floor(numberValue(item.replenishable_qty, 0)))
    : 0;
  const stock = Math.max(0, Math.floor(numberValue(item.source_qty ?? item.qty, 0)));
  const reserved = Math.max(0, Math.floor(numberValue(item.reserved, 0)));
  const availableEach = replenishableQty > 0 ? replenishableQty : Math.max(0, stock - reserved);
  const bySku = new Map((variants || []).map((variant) => [textValue(variant.sku).toLowerCase(), variant]));
  const expected = expectedVariantQuantities(item, options);
  const matchedExpected = expected.filter((row) => bySku.has(textValue(row.sku).toLowerCase()));
  const expectedPackMatched = matchedExpected.some((row) => row.role === "pack");
  const shopifyPackRows = (variants || [])
    .map((variant) => ({ variant, pack: parseShopifyPackVariantSku(variant.sku, bases) }))
    .filter((row) => row.pack)
    .map((row) => {
      const packQuantity = options.packMode === "divide" ? Math.floor(availableEach / row.pack.uomQty) : availableEach;
      return {
        sku: textValue(row.variant.sku),
        quantity: packQuantity,
        role: "pack",
        uomQty: row.pack.uomQty,
        matchedFromShopify: true
      };
    });
  const rows = expectedPackMatched ? matchedExpected : [...matchedExpected, ...shopifyPackRows];
  for (const row of expected) {
    if (row.role !== "each") continue;
    if (bySku.has(textValue(row.sku).toLowerCase()) && !rows.some((existing) => textValue(existing.sku).toLowerCase() === textValue(row.sku).toLowerCase())) rows.push(row);
  }
  const seen = new Set();
  return rows.filter((row) => {
    const key = textValue(row.sku).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function requestJson(options, payload = null) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : "";
    const req = https.request({
      ...options,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
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
          return reject(new Error(`Non-JSON response (${res.statusCode}) from ${options.path}`));
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

async function shopifyAccessToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!shop || !clientId || !clientSecret) throw new Error("Shopify credentials are not configured.");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  }).toString();
  const data = await requestJson({
    hostname: shop,
    path: "/admin/oauth/access_token",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body)
    }
  }, null, body);
  if (!data.access_token) throw new Error("Shopify token response did not include access_token.");
  return data.access_token;
}

function requestJsonRaw(options, body = "") {
  return new Promise((resolve, reject) => {
    const req = https.request({
      ...options,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) } : {}),
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
          return reject(new Error(`Non-JSON response (${res.statusCode}) from ${options.path}`));
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
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!shop || !clientId || !clientSecret) throw new Error("Shopify credentials are not configured.");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  }).toString();
  const data = await requestJsonRaw({
    hostname: shop,
    path: "/admin/oauth/access_token",
    method: "POST"
  }, body);
  if (!data.access_token) throw new Error("Shopify token response did not include access_token.");
  return data.access_token;
}

async function graphql(query, variables = {}, token) {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-04";
  const data = await requestJson({
    hostname: shop,
    path: `/admin/api/${encodeURIComponent(version)}/graphql.json`,
    method: "POST",
    headers: { "X-Shopify-Access-Token": token }
  }, { query, variables });
  if (Array.isArray(data.errors) && data.errors.length) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(data.errors).slice(0, 1000)}`);
  }
  return data.data || {};
}

async function fetchLocations(token) {
  const query = `
    query DataPlusLocations {
      locations(first: 50) {
        nodes { id name isActive fulfillsOnlineOrders }
      }
    }
  `;
  const data = await graphql(query, {}, token);
  return data.locations?.nodes || [];
}

function availableAtLocation(variant = {}) {
  const quantities = variant.inventoryItem?.inventoryLevel?.quantities || [];
  const available = quantities.find((quantity) => quantity.name === "available");
  return numberValue(available?.quantity, 0);
}

async function fetchProductVariants(productId, locationId, token) {
  const query = `
    query DataPlusProductVariants($id: ID!, $locationId: ID!) {
      node(id: $id) {
        ... on Product {
          id
          variants(first: 100) {
            nodes {
              id
              sku
              inventoryQuantity
              inventoryItem {
                id
                tracked
                inventoryLevel(locationId: $locationId) {
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      }
    }
  `;
  const data = await graphql(query, { id: productId, locationId }, token);
  return data.node?.variants?.nodes || [];
}

async function fetchProductsVariants(productIds, locationId, token) {
  const ids = [...new Set(productIds.map((id) => normalizeGid(id, "Product")).filter(Boolean))];
  if (!ids.length) return new Map();
  const query = `
    query DataPlusProductVariantsBatch($ids: [ID!]!, $locationId: ID!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          variants(first: 100) {
            nodes {
              id
              sku
              inventoryQuantity
              inventoryItem {
                id
                tracked
                inventoryLevel(locationId: $locationId) {
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      }
    }
  `;
  const data = await graphql(query, { ids, locationId }, token);
  const map = new Map();
  for (const node of data.nodes || []) {
    if (node?.id) map.set(node.id, node.variants?.nodes || []);
  }
  return map;
}

async function setInventory(batch, locationId, token, reference) {
  const query = `
    mutation DataPlusInventorySet($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
      inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup {
          reason
          referenceDocumentUri
          changes { name delta quantityAfterChange }
        }
        userErrors { code field message }
      }
    }
  `;
  const variables = {
    input: {
      name: "available",
      reason: "correction",
      referenceDocumentUri: reference,
      quantities: batch.map((row) => ({
        inventoryItemId: row.inventoryItemId,
        locationId,
        quantity: row.quantity,
        changeFromQuantity: null
      }))
    },
    idempotencyKey: crypto.randomUUID()
  };
  const data = await graphql(query, variables, token);
  return data.inventorySetQuantities || {};
}

async function loadLinkedProducts(limit) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const params = [];
    const limitSql = limit > 0 ? `limit $1` : "";
    if (limit > 0) params.push(limit);
    const result = await pool.query(`
      select
        p.product_id,
        p.sku,
        p.vendor_sku,
        p.mfr_part_number,
        coalesce(vci.qty, p.qty, 0) as source_qty,
        coalesce(p.raw->>'reserved', '0') as reserved,
        coalesce(p.raw->>'replenishableUseVendorRules', 'false') as replenishable_use_vendor_rules,
        coalesce(p.raw->>'replenishable', 'false') as replenishable,
        coalesce(p.raw->>'replenishableQtyUseVendorDefault', 'false') as replenishable_qty_use_vendor_default,
        coalesce(p.raw->>'replenishableQty', '0') as replenishable_qty,
        coalesce(vci.uom, p.uom, p.raw->>'uom', '') as uom,
        coalesce(vci.uom_qty::text, p.uom_qty::text, p.raw->>'uomQty', p.raw->>'uom_qty', '1') as uom_qty,
        coalesce(sps.shopify_id, p.raw->>'shopifyId', '') as shopify_id,
        coalesce(sps.shopify_variant_id, p.raw->>'shopifyVariantId', '') as shopify_variant_id
      from products p
      left join shopify_product_statuses sps on sps.product_id = p.product_id
      left join lateral (
        select qty, uom, uom_qty
        from vendor_catalog_items
        where lower(source_sku) = lower(p.sku)
           or lower(internal_sku) = lower(p.sku)
           or lower(vendor_sku) = lower(coalesce(p.vendor_sku, p.sku))
        order by (lower(source_sku) = lower(p.sku)) desc, updated_at desc
        limit 1
      ) vci on true
      where coalesce(sps.shopify_id, p.raw->>'shopifyId', '') <> ''
      order by p.sku
      ${limitSql}
    `, params);
    return result.rows;
  } finally {
    await pool.end();
  }
}

async function main() {
  loadLocalEnv();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const dryRun = hasFlag("dry-run");
  const apply = hasFlag("apply") && !dryRun;
  const limit = Math.max(0, Number(argValue("limit", "0")) || 0);
  const explicitLocation = normalizeGid(argValue("location", ""), "Location");
  const batchSize = Math.max(1, Math.min(250, Number(argValue("batch-size", "100")) || 100));
  const packMode = ["divide", "export"].includes(argValue("pack-mode", "export")) ? argValue("pack-mode", "export") : "export";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(OUTPUT_DIR, `shopify-inventory-${apply ? "applied" : "dry-run"}-${timestamp}.json`);
  const token = await shopifyToken();
  const locations = await fetchLocations(token);
  const activeLocations = locations.filter((location) => location.isActive !== false);
  const locationId = explicitLocation || activeLocations[0]?.id || locations[0]?.id || "";
  if (!locationId) throw new Error("No Shopify location found for inventory update.");

  const products = await loadLinkedProducts(limit);
  const report = {
    mode: apply ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    locationId,
    locationName: locations.find((location) => location.id === locationId)?.name || "",
    packMode,
    productsLoaded: products.length,
    variantsPrepared: 0,
    variantsChanged: 0,
    variantsApplied: 0,
    productsMissingVariants: 0,
    skippedUntracked: 0,
    errors: [],
    samples: []
  };

  const updates = [];
  const missingProducts = [];
  let processed = 0;
  const productBatchSize = Math.max(1, Math.min(50, Number(argValue("product-batch-size", "35")) || 35));
  for (let productIndex = 0; productIndex < products.length; productIndex += productBatchSize) {
    const productBatch = products.slice(productIndex, productIndex + productBatchSize);
    let variantsByProduct = new Map();
    try {
      variantsByProduct = await fetchProductsVariants(productBatch.map((product) => product.shopify_id), locationId, token);
    } catch (error) {
      report.errors.push({ batch: `${productIndex + 1}-${productIndex + productBatch.length}`, error: error.message });
      continue;
    }
    for (const product of productBatch) {
      processed += 1;
      if (processed % 250 === 0) process.stderr.write(`Checked ${processed}/${products.length}; prepared ${updates.length}\r`);
      const productId = normalizeGid(product.shopify_id, "Product");
      if (!productId) continue;
      const variants = variantsByProduct.get(productId) || [];
      const bySku = new Map(variants.map((variant) => [textValue(variant.sku).toLowerCase(), variant]));
      const expectedRows = expectedVariantQuantitiesForShopify(product, variants, { packMode });
      let matched = 0;
      for (const expected of expectedRows) {
        const variant = bySku.get(expected.sku.toLowerCase());
        if (!variant?.inventoryItem?.id) continue;
        matched += 1;
        if (variant.inventoryItem.tracked === false) {
          report.skippedUntracked += 1;
          continue;
        }
        const current = Math.max(0, Math.floor(availableAtLocation(variant)));
        const quantity = Math.max(0, Math.floor(numberValue(expected.quantity, 0)));
        report.variantsPrepared += 1;
        if (current === quantity) continue;
        const update = {
          sku: expected.sku,
          baseSku: product.sku,
          role: expected.role,
          uomQty: expected.uomQty,
          current,
          quantity,
          delta: quantity - current,
          productId,
          variantId: variant.id,
          inventoryItemId: variant.inventoryItem.id
        };
        updates.push(update);
        report.variantsChanged += 1;
        if (report.samples.length < 25) report.samples.push(update);
      }
      if (!matched) {
        report.productsMissingVariants += 1;
        missingProducts.push({
          productId: product.product_id || "",
          sku: product.sku || "",
          vendorSku: product.vendor_sku || "",
          shopifyId: productId,
          expectedSkus: expectedRows.length ? expectedRows.map((expected) => expected.sku) : expectedVariantQuantities(product, { packMode }).map((expected) => expected.sku),
          shopifyVariantSkus: variants.map((variant) => variant.sku).filter(Boolean)
        });
      }
    }
  }
  process.stderr.write("\n");

  if (apply && updates.length) {
    const reference = `dataplus://shopify-inventory/${new Date().toISOString().slice(0, 10)}`;
    for (let index = 0; index < updates.length; index += batchSize) {
      const batch = updates.slice(index, index + batchSize);
      const result = await setInventory(batch, locationId, token, reference);
      const userErrors = result.userErrors || [];
      if (userErrors.length) {
        report.errors.push(...userErrors.map((error) => ({ batch: `${index + 1}-${index + batch.length}`, error })));
      } else {
        report.variantsApplied += batch.length;
      }
      process.stderr.write(`Applied ${report.variantsApplied}/${updates.length}\r`);
    }
    process.stderr.write("\n");
  }

  fs.writeFileSync(reportPath, JSON.stringify({ ...report, updates: updates.slice(0, 1000), missingProducts }, null, 2));
  console.log(JSON.stringify({ ...report, reportPath, updatesStored: Math.min(updates.length, 1000), missingProductsStored: missingProducts.length }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
