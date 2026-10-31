const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shopifySourceIsAllowed } = require("../server");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const allowlistStart = source.indexOf("function shopifySourceIsAllowed");
const orderMapperStart = source.indexOf("function shopifyOrderToDataPlusOrder");
const contextStart = source.indexOf("async function readShopifyOrderImportContext");
const importStart = source.indexOf("async function importShopifyOrders");
const webhookStart = source.indexOf("async function refreshShopifyOrderFromWebhook");

assert.ok(contextStart >= 0, "Shopify imports need a lightweight PostgreSQL context");
assert.ok(importStart > contextStart, "Shopify order import should follow the lightweight context helper");

const allowlistSource = source.slice(allowlistStart, orderMapperStart);
assert.match(allowlistSource, /nativeAliases/);
assert.doesNotMatch(allowlistSource, /return \["web", "shop"/, "Native source groups must not return before explicit sources are checked");
assert.match(allowlistSource, /return allowed\.includes\(raw\) \|\| allowed\.includes\(display\)/);
assert.equal(shopifySourceIsAllowed({ shopifySourceName: "web", channelSource: "Online Store" }, "Native Shopify sources, temu"), true);
assert.equal(shopifySourceIsAllowed({ shopifySourceName: "temu", channelSource: "temu" }, "Native Shopify sources, temu"), true);
assert.equal(shopifySourceIsAllowed({ shopifySourceName: "ebay", channelSource: "ebay" }, "Native Shopify sources, temu"), false);

const contextSource = source.slice(contextStart, importStart);
assert.match(contextSource, /readStateField\("sequence"\)/);
assert.match(contextSource, /readStateField\("connections"\)/);
assert.doesNotMatch(contextSource, /readState\(/, "PostgreSQL imports must not hydrate full application state");

const importSource = source.slice(importStart, webhookStart);
assert.match(importSource, /const db = await readShopifyOrderImportContext\(\)/);
assert.match(importSource, /Math\.min\(pageSize, maxOrders - processed\)/);
assert.match(importSource, /Math\.min\(100, Number\(filters\.pageSize \|\| 50\)/);

console.log("Shopify order imports use bounded pages and lightweight state.");
