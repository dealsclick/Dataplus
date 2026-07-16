const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "outputs", "shopify-collection-redirects");

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function latestArchiveReport() {
  const files = fs.readdirSync(REPORT_DIR)
    .filter((name) => /^collection-handle-archive-.*\.json$/.test(name))
    .map((name) => path.join(REPORT_DIR, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files.length) throw new Error("No archived collection handle report found.");
  return { file: files[0], report: JSON.parse(fs.readFileSync(files[0], "utf8")) };
}

function shopifyConfig() {
  return {
    shop: String(process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_STORE || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, ""),
    clientId: String(process.env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_APP_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_APP_CLIENT_SECRET || "").trim(),
    accessToken: String(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN || "").trim(),
    apiVersion: String(process.env.SHOPIFY_ADMIN_API_VERSION || "2026-04").trim()
  };
}

function requestJson(options, body = "") {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = {};
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          return reject(new Error(`Shopify returned non-JSON (${response.statusCode}): ${text.slice(0, 500)}`));
        }
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`Shopify API error (${response.statusCode}): ${text.slice(0, 1200)}`));
        resolve(json);
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

let tokenCache = "";

async function shopifyAccessToken() {
  const config = shopifyConfig();
  if (config.accessToken) return config.accessToken;
  if (tokenCache) return tokenCache;
  const payload = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret
  }).toString();
  const data = await requestJson({
    hostname: config.shop,
    path: "/admin/oauth/access_token",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(payload)
    }
  }, payload);
  tokenCache = String(data.access_token || "").trim();
  if (!tokenCache) throw new Error("Shopify token response did not include access_token.");
  return tokenCache;
}

async function shopifyGraphql(query, variables = {}) {
  const config = shopifyConfig();
  const body = JSON.stringify({ query, variables });
  const data = await requestJson({
    hostname: config.shop,
    path: `/admin/api/${encodeURIComponent(config.apiVersion)}/graphql.json`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "X-Shopify-Access-Token": await shopifyAccessToken()
    }
  }, body);
  if (Array.isArray(data.errors) && data.errors.length) throw new Error(`Shopify GraphQL error: ${data.errors.map((error) => error.message || JSON.stringify(error)).join("; ")}`);
  return data.data || {};
}

async function collectionByHandle(handle) {
  const data = await shopifyGraphql(
    `query CollectionByHandle($query: String!) {
      collections(first: 5, query: $query) {
        nodes { id handle title }
      }
    }`,
    { query: `handle:${handle}` }
  );
  return (data.collections?.nodes || []).find((row) => row.handle === handle) || null;
}

async function deleteCollection(id) {
  const data = await shopifyGraphql(
    `mutation DeleteCollection($input: CollectionDeleteInput!) {
      collectionDelete(input: $input) {
        deletedCollectionId
        userErrors { field message }
      }
    }`,
    { input: { id } }
  );
  const errors = data.collectionDelete?.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => `${(error.field || []).join(".")}: ${error.message}`).join("; "));
  return data.collectionDelete?.deletedCollectionId || id;
}

(async () => {
  loadEnv();
  const { file, report } = latestArchiveReport();
  const archived = report.archived || [];
  const output = {
    generatedAt: new Date().toISOString(),
    sourceReport: file,
    total: archived.length,
    deleted: [],
    skipped: [],
    errors: []
  };
  for (const row of archived) {
    const handle = String(row.archivedHandle || "").trim();
    if (!handle || !handle.startsWith("legacy-")) {
      output.skipped.push({ ...row, reason: "not_a_legacy_handle" });
      continue;
    }
    try {
      const collection = await collectionByHandle(handle);
      if (!collection) {
        output.skipped.push({ ...row, reason: "already_deleted" });
        continue;
      }
      const deletedCollectionId = await deleteCollection(collection.id);
      output.deleted.push({ ...row, deletedCollectionId, deletedHandle: handle, title: collection.title });
      console.log(`Deleted ${handle}`);
    } catch (error) {
      output.errors.push({ ...row, error: error.message });
    }
  }
  const reportPath = path.join(REPORT_DIR, `collection-delete-legacy-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ reportPath, deleted: output.deleted.length, skipped: output.skipped.length, errors: output.errors.length }, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
