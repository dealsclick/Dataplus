const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
loadEnv(path.join(ROOT, ".env"));

const SHOPIFY_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-04";
const COLLECTIONS = [
  {
    title: "Shipping - LTL Freight",
    handle: "shipping-ltl-freight",
    tag: "shipping-ltl",
    description: "Products that require LTL freight handling based on DataPlus package dimensions."
  },
  {
    title: "Shipping - Oversize Parcel",
    handle: "shipping-oversize-parcel",
    tag: "shipping-oversize-parcel",
    description: "Products that are parcel-shippable but oversize based on DataPlus package dimensions."
  }
];

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function requestJson(options, body = "") {
  return new Promise((resolve, reject) => {
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
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  }, body);
  if (!data.access_token) throw new Error("Shopify token response did not include access_token.");
  return data.access_token;
}

async function rest(method, resourcePath, body, token) {
  return requestJson({
    hostname: process.env.SHOPIFY_STORE_DOMAIN,
    path: `/admin/api/${encodeURIComponent(SHOPIFY_VERSION)}${resourcePath}`,
    method,
    headers: { "X-Shopify-Access-Token": token }
  }, body ? JSON.stringify(body) : "");
}

async function upsertCollection(collection, token, apply) {
  const existing = await rest("GET", `/smart_collections.json?handle=${encodeURIComponent(collection.handle)}&limit=1`, null, token);
  const current = Array.isArray(existing.smart_collections) ? existing.smart_collections[0] : null;
  const payload = {
    title: collection.title,
    handle: collection.handle,
    body_html: collection.description,
    published: true,
    published_scope: "global",
    sort_order: "best-selling",
    rules: [{ column: "tag", relation: "equals", condition: collection.tag }],
    disjunctive: false,
    metafields_global_title_tag: collection.title,
    metafields_global_description_tag: collection.description
  };
  if (!apply) return { action: current?.id ? "would_update" : "would_create", id: current?.id || "", ...collection };
  if (current?.id) {
    const updated = await rest("PUT", `/smart_collections/${encodeURIComponent(current.id)}.json`, { smart_collection: { id: current.id, ...payload } }, token);
    return { action: "updated", id: updated.smart_collection?.id || current.id, ...collection };
  }
  const created = await rest("POST", "/smart_collections.json", { smart_collection: payload }, token);
  return { action: "created", id: created.smart_collection?.id || "", ...collection };
}

async function main() {
  const apply = hasFlag("apply");
  const token = await shopifyToken();
  const results = [];
  for (const collection of COLLECTIONS) {
    results.push(await upsertCollection(collection, token, apply));
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
