const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OLD_MENU_FILE = path.join(ROOT, "data", "templates", "matrixify-main-menu-import.before-new-categories-2026-07-08.csv");
const NEW_MENU_FILE = path.join(ROOT, "data", "templates", "matrixify-main-menu-import.csv");
const OLD_MAPPING_FILE = path.join(ROOT, "data", "templates", "shopify-menu-collection-mapping.csv");
const OUTPUT_DIR = path.join(ROOT, "outputs", "shopify-collection-redirects");

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

function parseCsv(text = "") {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else value += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") value += char;
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows.shift();
  return rows
    .filter((cells) => cells.some((cell) => String(cell || "").trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""])));
}

function csvEscape(value = "") {
  const text = value == null ? "" : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(filePath, rows = []) {
  const columns = rows.length ? Object.keys(rows[0]) : ["path", "target"];
  fs.writeFileSync(filePath, `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")).join("\n")}\n`, "utf8");
}

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set(["and", "or", "the", "for", "with", "to", "of", "in", "on", "by", "a", "an", "items", "item", "products", "product", "supplies", "supply"]);
const WEAK_TITLES = new Set(["0", "1", "2", "3", "accessories", "parts", "other", "misc", "miscellaneous", "uncategorized"]);

function tokens(value = "") {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function weightedTokens(...parts) {
  const map = new Map();
  for (const [value, weight] of parts) {
    for (const token of tokens(value)) map.set(token, (map.get(token) || 0) + weight);
  }
  return map;
}

function similarity(source, target) {
  let shared = 0;
  let sourceTotal = 0;
  let targetTotal = 0;
  for (const weight of source.values()) sourceTotal += weight;
  for (const weight of target.values()) targetTotal += weight;
  for (const [token, weight] of source) {
    if (target.has(token)) shared += Math.min(weight, target.get(token));
  }
  return shared / Math.max(1, Math.min(sourceTotal, targetTotal));
}

function leafTokens(value = "") {
  const parts = String(value || "").split(">").map((part) => part.trim()).filter(Boolean);
  return new Set(tokens(parts[parts.length - 1] || value));
}

function sharedTokenCount(a = new Set(), b = new Set()) {
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count;
}

function collectionRows(rows = []) {
  return rows
    .filter((row) => String(row["Menu Item: Resource Type"] || "").trim().toUpperCase() === "COLLECTION")
    .map((row) => ({
      handle: String(row["Menu Item: Resource Handle"] || "").trim(),
      title: String(row["Menu Item: Title"] || "").trim(),
      parentTitle: String(row["Menu Item: Parent Title"] || "").trim(),
      pathText: [row["Menu Item: Parent Title"], row["Menu Item: Title"], row["Menu Item: Resource Handle"]].filter(Boolean).join(" > ")
    }))
    .filter((row) => row.handle);
}

function buildPreview({ minScore = 0.42 } = {}) {
  const oldRows = collectionRows(parseCsv(fs.readFileSync(OLD_MENU_FILE, "utf8")));
  const newRows = collectionRows(parseCsv(fs.readFileSync(NEW_MENU_FILE, "utf8")));
  const oldMapping = parseCsv(fs.readFileSync(OLD_MAPPING_FILE, "utf8"));
  const oldHandles = new Set(oldRows.map((row) => row.handle.toLowerCase()));
  const mappingByHandle = new Map(oldMapping.map((row) => [String(row["Collection Handle"] || "").trim().toLowerCase(), row]));
  const newCandidates = newRows
    .filter((row) => !oldHandles.has(row.handle.toLowerCase()))
    .filter((row) => {
      const titleKey = normalizeText(row.title);
      if (!titleKey || WEAK_TITLES.has(titleKey)) return false;
      return tokens([row.title, row.parentTitle, row.handle].join(" ")).length >= 2;
    })
    .map((row) => ({
      ...row,
      leafTokenSet: leafTokens(row.title),
      tokenMap: weightedTokens([row.title, 5], [row.parentTitle, 3], [row.pathText, 2], [row.handle, 2])
    }));

  const redirects = [];
  const rejected = [];
  const usedPaths = new Set();
  for (const oldRow of oldRows) {
    const mapping = mappingByHandle.get(oldRow.handle.toLowerCase()) || {};
    const sourceText = [
      oldRow.title,
      oldRow.parentTitle,
      oldRow.handle,
      mapping["Product Type Rule"],
      mapping["Original Full Category Path"],
      mapping["Menu Path"]
    ].filter(Boolean).join(" > ");
    const sourceTokens = weightedTokens([oldRow.title, 6], [oldRow.parentTitle, 3], [oldRow.handle, 2], [sourceText, 2]);
    const sourceLeafTokens = leafTokens(oldRow.title);
    let best = null;
    for (const candidate of newCandidates) {
      const score = similarity(sourceTokens, candidate.tokenMap);
      const leafShared = sharedTokenCount(sourceLeafTokens, candidate.leafTokenSet);
      const phraseBonus = normalizeText(candidate.title).includes(normalizeText(oldRow.title)) || normalizeText(oldRow.title).includes(normalizeText(candidate.title)) ? 0.2 : 0;
      const adjustedScore = score + phraseBonus;
      if (!best || adjustedScore > best.score) best = { ...candidate, score: adjustedScore, rawScore: score, leafShared };
    }
    const pathValue = `/collections/${oldRow.handle}`;
    const oldLeafSize = Math.max(1, sourceLeafTokens.size);
    const enoughLeafOverlap = best && (best.leafShared >= Math.min(2, oldLeafSize) || best.score >= 0.78);
    if (!best || best.score < minScore || !enoughLeafOverlap || best.handle.toLowerCase() === oldRow.handle.toLowerCase() || usedPaths.has(pathValue)) {
      rejected.push({
        old_handle: oldRow.handle,
        old_title: oldRow.title,
        best_handle: best?.handle || "",
        best_title: best?.title || "",
        score: best ? best.score.toFixed(3) : "0.000",
        reason: !best ? "no_match" : best.score < minScore ? "low_score" : !enoughLeafOverlap ? "weak_leaf_overlap" : "duplicate_or_self"
      });
      continue;
    }
    usedPaths.add(pathValue);
    redirects.push({
      path: pathValue,
      target: `/collections/${best.handle}`,
      old_handle: oldRow.handle,
      old_title: oldRow.title,
      old_parent: oldRow.parentTitle,
      new_handle: best.handle,
      new_title: best.title,
      new_parent: best.parentTitle,
      score: best.score.toFixed(3)
    });
  }
  return { redirects, rejected, oldRows, newRows, newCandidates };
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
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`Shopify API error (${response.statusCode}): ${text.slice(0, 1200)}`));
        }
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
  if (Array.isArray(data.errors) && data.errors.length) {
    throw new Error(`Shopify GraphQL error: ${data.errors.map((error) => error.message || JSON.stringify(error)).join("; ")}`);
  }
  return data.data || {};
}

async function existingRedirectsByPath(paths = []) {
  const found = new Map();
  for (const pathValue of paths) {
    const data = await shopifyGraphql(
      `query Redirects($query: String!) {
        urlRedirects(first: 10, query: $query) {
          nodes { id path target }
        }
      }`,
      { query: `path:${pathValue}` }
    );
    for (const row of data.urlRedirects?.nodes || []) {
      if (String(row.path || "").toLowerCase() === pathValue.toLowerCase()) found.set(pathValue, row);
    }
  }
  return found;
}

async function pushRedirects(redirects = []) {
  const existing = await existingRedirectsByPath(redirects.map((row) => row.path));
  const result = { created: [], updated: [], skipped: [], errors: [] };
  for (const row of redirects) {
    const current = existing.get(row.path);
    try {
      if (current && current.target === row.target) {
        result.skipped.push({ ...row, id: current.id, reason: "already_current" });
        continue;
      }
      if (current) {
        const data = await shopifyGraphql(
          `mutation UpdateRedirect($id: ID!, $urlRedirect: UrlRedirectInput!) {
            urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) {
              urlRedirect { id path target }
              userErrors { field message }
            }
          }`,
          { id: current.id, urlRedirect: { path: row.path, target: row.target } }
        );
        const userErrors = data.urlRedirectUpdate?.userErrors || [];
        if (userErrors.length) throw new Error(userErrors.map((error) => `${(error.field || []).join(".")}: ${error.message}`).join("; "));
        result.updated.push({ ...row, id: data.urlRedirectUpdate?.urlRedirect?.id || current.id });
      } else {
        const data = await shopifyGraphql(
          `mutation CreateRedirect($urlRedirect: UrlRedirectInput!) {
            urlRedirectCreate(urlRedirect: $urlRedirect) {
              urlRedirect { id path target }
              userErrors { field message }
            }
          }`,
          { urlRedirect: { path: row.path, target: row.target } }
        );
        const userErrors = data.urlRedirectCreate?.userErrors || [];
        if (userErrors.length) throw new Error(userErrors.map((error) => `${(error.field || []).join(".")}: ${error.message}`).join("; "));
        result.created.push({ ...row, id: data.urlRedirectCreate?.urlRedirect?.id || "" });
      }
    } catch (error) {
      result.errors.push({ ...row, error: error.message });
    }
  }
  return result;
}

(async () => {
  loadEnv();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const push = process.argv.includes("--push");
  const minScoreArg = process.argv.find((arg) => arg.startsWith("--min-score="));
  const minScore = minScoreArg ? Number(minScoreArg.split("=")[1]) : 0.42;
  const { redirects, rejected, oldRows, newRows, newCandidates } = buildPreview({ minScore });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const previewCsv = path.join(OUTPUT_DIR, `collection-redirect-preview-${stamp}.csv`);
  const rejectedCsv = path.join(OUTPUT_DIR, `collection-redirect-rejected-${stamp}.csv`);
  writeCsv(previewCsv, redirects);
  writeCsv(rejectedCsv, rejected);
  const report = {
    generatedAt: new Date().toISOString(),
    minScore,
    oldCollectionRows: oldRows.length,
    newCollectionRows: newRows.length,
    newOnlyCandidates: newCandidates.length,
    redirectCandidates: redirects.length,
    rejected: rejected.length,
    previewCsv,
    rejectedCsv,
    pushed: false
  };
  if (push) {
    report.pushResult = await pushRedirects(redirects);
    report.pushed = true;
  }
  const reportPath = path.join(OUTPUT_DIR, `collection-redirect-report-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ reportPath, ...report }, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
