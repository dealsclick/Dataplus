const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shopifyOrderToDataPlusOrder, shopifySourceIsAllowed } = require("../server");

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

const temuOrder = shopifyOrderToDataPlusOrder({
  id: "gid://shopify/Order/123",
  legacyResourceId: "123",
  name: "#DC1001",
  sourceName: "temu",
  sourceIdentifier: "PO-211-0123456789012345",
  customAttributes: [{ key: "Temu order number", value: "fallback-should-not-win" }],
  lineItems: { edges: [] }
});
assert.equal(temuOrder.id, "shopify-order-123", "Shopify remains the immutable import identity");
assert.equal(temuOrder.marketplaceOrderId, "gid://shopify/Order/123");
assert.equal(temuOrder.marketplaceOrderNumber, "#DC1001", "Shopify order number remains available");
assert.equal(temuOrder.channelOrderNumber, "PO-211-0123456789012345", "originating Temu order number is retained separately");
assert.deepEqual(temuOrder.marketplaceReferences.map((reference) => reference.type), ["source_order", "order", "gid"]);

const contextSource = source.slice(contextStart, importStart);
assert.match(contextSource, /readStateField\("sequence"\)/);
assert.match(contextSource, /readStateField\("connections"\)/);
assert.doesNotMatch(contextSource, /readState\(/, "PostgreSQL imports must not hydrate full application state");

const importSource = source.slice(importStart, webhookStart);
assert.match(importSource, /const db = await readShopifyOrderImportContext\(\)/);
assert.match(importSource, /Math\.min\(pageSize, maxOrders - processed\)/);
assert.match(importSource, /Math\.min\(100, Number\(filters\.pageSize \|\| 50\)/);
assert.match(importSource, /sourceIdentifier customAttributes \{ key value \}/, "scheduled imports must request the originating marketplace order number");

console.log("Shopify order imports use bounded pages and lightweight state.");
