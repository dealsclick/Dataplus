const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_MENU_FILE = path.join(ROOT, "data", "templates", "matrixify-main-menu-import.csv");
const OUTPUT_DIR = path.join(ROOT, "outputs", "shopify-menu-push");

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg === name || arg.startsWith(prefix));
  if (!match) return fallback;
  if (match === name) return "true";
  return match.slice(prefix.length);
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
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
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
    } else if (char !== "\r") {
      value += char;
    }
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

function shopifyConfig() {
  const shop = String(process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_STORE || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/g, "");
  return {
    shop,
    accessToken: String(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN || "").trim(),
    clientId: String(process.env.SHOPIFY_CLIENT_ID || process.env.SHOPIFY_APP_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_APP_CLIENT_SECRET || "").trim(),
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
          return reject(new Error(`Shopify returned a non-JSON response (${response.statusCode}): ${text.slice(0, 500)}`));
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

let tokenCache = null;

async function shopifyAccessToken() {
  const config = shopifyConfig();
  if (!config.shop) throw new Error("SHOPIFY_STORE_DOMAIN is missing.");
  if (config.accessToken) return { token: config.accessToken, scope: "" };
  if (!config.clientId || !config.clientSecret) throw new Error("Shopify credentials are missing.");
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
  const token = String(data.access_token || "").trim();
  if (!token) throw new Error("Shopify token response did not include access_token.");
  tokenCache = { token, scope: String(data.scope || "") };
  return tokenCache;
}

async function shopifyGraphql(query, variables = {}) {
  const config = shopifyConfig();
  const { token } = await shopifyAccessToken();
  const body = JSON.stringify({ query, variables });
  const data = await requestJson({
    hostname: config.shop,
    path: `/admin/api/${encodeURIComponent(config.apiVersion)}/graphql.json`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "X-Shopify-Access-Token": token
    }
  }, body);
  if (Array.isArray(data.errors) && data.errors.length) {
    throw new Error(`Shopify GraphQL error: ${data.errors.map((error) => error.message || JSON.stringify(error)).join("; ")}`);
  }
  return data.data || {};
}

function numericPosition(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildMenuTree(rows = [], collectionIdByHandle = new Map()) {
  const itemRows = rows
    .filter((row) => String(row["Menu Item: ID"] || row["Menu Item: Title"] || row["Menu Item: Resource Handle"] || "").trim())
    .map((row, index) => ({
      row,
      index,
      id: String(row["Menu Item: ID"] || "").trim(),
      title: String(row["Menu Item: Title"] || "").trim(),
      type: String(row["Menu Item: Resource Type"] || "").trim().toUpperCase(),
      url: String(row["Menu Item: URL"] || "").trim(),
      handle: String(row["Menu Item: Resource Handle"] || "").trim(),
      parentId: String(row["Menu Item: Parent ID"] || "").trim(),
      position: numericPosition(row["Menu Item: Position"], index + 1),
      children: []
    }))
    .filter((item) => item.id && item.title);

  const byId = new Map(itemRows.map((item) => [item.id, item]));
  const roots = [];
  for (const item of itemRows) {
    if (item.parentId && byId.has(item.parentId)) byId.get(item.parentId).children.push(item);
    else roots.push(item);
  }

  const missingCollections = [];
  const maxDepth = (items, depth = 1) => items.reduce((max, item) => {
    const childDepth = item.children.length ? maxDepth(item.children, depth + 1) : depth;
    return Math.max(max, childDepth);
  }, 0);
  const toInput = (item) => {
    const children = item.children
      .sort((a, b) => a.position - b.position || a.index - b.index)
      .map(toInput);
    const input = { title: item.title, type: "HTTP" };
    if (item.type === "COLLECTION" && item.handle) {
      const resourceId = collectionIdByHandle.get(item.handle.toLowerCase());
      if (resourceId) {
        input.type = "COLLECTION";
        input.resourceId = resourceId;
      } else {
        input.type = "HTTP";
        input.url = `/collections/${item.handle}`;
        missingCollections.push(item.handle);
      }
    } else {
      input.type = "HTTP";
      input.url = item.url || "#";
    }
    if (children.length) input.items = children;
    return input;
  };

  return {
    depth: maxDepth(roots),
    roots: roots.sort((a, b) => a.position - b.position || a.index - b.index),
    items: roots.sort((a, b) => a.position - b.position || a.index - b.index).map(toInput),
    missingCollections: [...new Set(missingCollections)]
  };
}

async function readMenu(handle = "main-menu") {
  const data = await shopifyGraphql(
    `query MenuByHandle($query: String!) {
      menus(first: 10, query: $query) {
        nodes {
          id
          handle
          title
          isDefault
          items {
            id
            title
            type
            url
            resourceId
            items {
              id
              title
              type
              url
              resourceId
              items {
                id
                title
                type
                url
                resourceId
              }
            }
          }
        }
      }
    }`,
    { query: `handle:${handle}` }
  );
  return (data.menus?.nodes || []).find((menu) => menu.handle === handle) || null;
}

function menuItemKey(item = {}) {
  return [
    String(item.title || "").trim().toLowerCase(),
    String(item.type || "").trim().toUpperCase(),
    String(item.resourceId || "").trim(),
    String(item.url || "").trim().toLowerCase()
  ].join("|");
}

function shopifyItemToInput(item = {}) {
  const input = {
    id: item.id,
    title: item.title,
    type: item.type || "HTTP"
  };
  if (item.resourceId) input.resourceId = item.resourceId;
  if (item.url) input.url = item.url;
  if (Array.isArray(item.items) && item.items.length) input.items = item.items.map(shopifyItemToInput);
  return input;
}

function applyExistingMenuIds(desiredItems = [], existingItems = []) {
  const existingByKey = new Map();
  for (const item of existingItems) {
    const key = menuItemKey(item);
    if (key && !existingByKey.has(key)) existingByKey.set(key, item);
  }
  return desiredItems.map((item) => {
    const existing = existingByKey.get(menuItemKey(item));
    const next = { ...item };
    if (existing?.id) next.id = existing.id;
    if (Array.isArray(item.items) && item.items.length) {
      next.items = applyExistingMenuIds(item.items, existing?.items || []);
    }
    return next;
  });
}

async function updateMenu(menuId, title, items) {
  const data = await shopifyGraphql(
    `mutation UpdateMenu($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
      menuUpdate(id: $id, title: $title, items: $items) {
        menu { id handle title items { id title items { id title items { id title } } } }
        userErrors { field message }
      }
    }`,
    { id: menuId, title, items }
  );
  const userErrors = data.menuUpdate?.userErrors || [];
  if (userErrors.length) {
    throw new Error(`Shopify menuUpdate returned errors: ${userErrors.map((error) => `${(error.field || []).join(".")}: ${error.message}`).join("; ")}`);
  }
  return data.menuUpdate?.menu || null;
}

async function readCollectionsByHandle() {
  const map = new Map();
  let after = null;
  do {
    const data = await shopifyGraphql(
      `query Collections($first: Int!, $after: String) {
        collections(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id handle title }
        }
      }`,
      { first: 250, after }
    );
    for (const collection of data.collections?.nodes || []) {
      if (collection.handle && collection.id) map.set(String(collection.handle).toLowerCase(), collection.id);
    }
    after = data.collections?.pageInfo?.hasNextPage ? data.collections.pageInfo.endCursor : null;
  } while (after);
  return map;
}

async function pushMenu({ handle = "main-menu", title = "Main menu", csvPath = DEFAULT_MENU_FILE, dryRun = false, progressive = false } = {}) {
  if (!fs.existsSync(csvPath)) throw new Error(`Menu CSV not found: ${csvPath}`);
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const { scope } = await shopifyAccessToken();
  const collectionIdByHandle = await readCollectionsByHandle();
  const tree = buildMenuTree(rows, collectionIdByHandle);
  if (tree.depth > 3) throw new Error(`Shopify menus support 3 levels. Generated menu has ${tree.depth} levels.`);
  const menu = await readMenu(handle);
  if (!menu) throw new Error(`Shopify menu handle "${handle}" was not found.`);

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun,
    shop: shopifyConfig().shop,
    apiVersion: shopifyConfig().apiVersion,
    tokenScope: scope,
    handle,
    title,
    menuId: menu.id,
    previousTitle: menu.title,
    previousTopLevelItems: menu.items?.length || 0,
    csvRows: rows.length,
    topLevelItems: tree.items.length,
    collectionLinks: rows.filter((row) => String(row["Menu Item: Resource Type"] || "").trim().toUpperCase() === "COLLECTION").length,
    missingCollectionHandles: tree.missingCollections,
    pushed: false,
    userErrors: []
  };

  if (!dryRun) {
    if (progressive) {
      let workingMenu = menu;
      const desiredByTitle = new Map(tree.items.map((item) => [String(item.title || "").trim().toLowerCase(), item]));
      const nextItems = (workingMenu.items || []).map(shopifyItemToInput);
      for (const desiredRoot of tree.items) {
        const rootKey = String(desiredRoot.title || "").trim().toLowerCase();
        const currentMenu = await readMenu(handle);
        const currentItems = (currentMenu?.items || []).map(shopifyItemToInput);
        const currentIndex = currentItems.findIndex((item) => String(item.title || "").trim().toLowerCase() === rootKey);
        const desiredWithIds = applyExistingMenuIds([desiredRoot], currentMenu?.items || [])[0];
        const mergedItems = currentItems.filter((item) => desiredByTitle.has(String(item.title || "").trim().toLowerCase()));
        const mergedIndex = mergedItems.findIndex((item) => String(item.title || "").trim().toLowerCase() === rootKey);
        if (mergedIndex >= 0) mergedItems[mergedIndex] = desiredWithIds;
        else if (currentIndex >= 0) mergedItems.splice(currentIndex, 0, desiredWithIds);
        else mergedItems.push(desiredWithIds);
        workingMenu = await updateMenu(menu.id, title, mergedItems);
        report.updatedTopLevelItems = workingMenu?.items?.length || mergedItems.length;
        report.lastUpdatedRoot = desiredRoot.title;
        console.log(`Updated menu branch: ${desiredRoot.title}`);
      }
    } else {
      await updateMenu(menu.id, title, applyExistingMenuIds(tree.items, menu.items || []));
      report.updatedTopLevelItems = tree.items.length;
    }
    report.pushed = true;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const reportPath = path.join(OUTPUT_DIR, `shopify-menu-push-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return { reportPath, report };
}

(async () => {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  const progressive = process.argv.includes("--progressive");
  const handle = argValue("--handle", "main-menu");
  const title = argValue("--title", "Main menu");
  const csvPath = path.resolve(ROOT, argValue("--file", DEFAULT_MENU_FILE));
  const result = await pushMenu({ handle, title, csvPath, dryRun, progressive });
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const reportPath = path.join(OUTPUT_DIR, `shopify-menu-push-error-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), error: error.message, stack: error.stack }, null, 2));
  console.error(error.message);
  console.error(`Report: ${reportPath}`);
  process.exit(1);
});
