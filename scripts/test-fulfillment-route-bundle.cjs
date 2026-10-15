const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "web", "src", "App.tsx"), "utf8");
const routeSource = fs.readFileSync(path.join(__dirname, "..", "web", "src", "components", "fulfillment-route.tsx"), "utf8");

assert.match(appSource, /const FulfillmentPage = lazy\(\(\) => import\("\.\/components\/fulfillment-route"\)/, "Fulfillment must load through the on-demand route module");
assert.match(appSource, /const ShippingBatchesPage = lazy\(\(\) => import\("\.\/components\/fulfillment-route"\)/, "Shipping Batches must share the on-demand fulfillment module");
assert.doesNotMatch(appSource, /function FulfillmentPage\s*\(/, "the Fulfillment implementation must not return to the default application bundle");
assert.doesNotMatch(appSource, /function ShippingBatchesPage\s*\(/, "the Shipping Batches implementation must not return to the default application bundle");
assert.match(routeSource, /export function FulfillmentPage\s*\(/, "the route module must export FulfillmentPage");
assert.match(routeSource, /export function ShippingBatchesPage\s*\(/, "the route module must export ShippingBatchesPage");
assert.ok((appSource.match(/<FulfillmentPage\s*\/>/g) || []).length >= 2, "desktop and mobile routing must still render FulfillmentPage");
assert.ok((appSource.match(/<ShippingBatchesPage\s*\/>/g) || []).length >= 1, "the dedicated Shipping Batches route must still render ShippingBatchesPage");

console.log("Fulfillment lazy route bundle tests passed.");
