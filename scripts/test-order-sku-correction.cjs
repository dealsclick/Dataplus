const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { updateOrderLineSku } = require("../server");

const order = {
  id: "order-test",
  orderNumber: "50001",
  sku: "CHANNEL-OLD",
  items: [{ sku: "CHANNEL-OLD", title: "Imported item", qty: 1 }],
  timeline: []
};

const updated = updateOrderLineSku(order, 0, "CATALOG-NEW", {
  mode: "correction",
  reason: "Channel listing used an obsolete SKU",
  user: "Test User"
});

assert.equal(updated.sku, "CATALOG-NEW");
assert.equal(updated.originalSku, "CHANNEL-OLD");
assert.equal(updated.mappedFromSku, "CHANNEL-OLD");
assert.equal(updated.skuMappingMode, "correction");
assert.equal(updated.skuMappedBy, "Test User");
assert.equal(order.sku, "CATALOG-NEW");

updateOrderLineSku(order, 0, "CATALOG-FINAL", {
  mode: "correction",
  reason: "Second reviewed correction",
  user: "Test User"
});
assert.equal(order.items[0].originalSku, "CHANNEL-OLD", "The original imported SKU must never be overwritten.");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const uiSource = fs.readFileSync(path.join(__dirname, "..", "web", "src", "components", "order-detail-route.tsx"), "utf8");
assert.match(serverSource, /req\.method === "PATCH"[\s\S]+parts\[5\] === "sku"/);
assert.match(serverSource, /Reason for the SKU correction is required/);
assert.match(serverSource, /createInventoryFromOrderLine[\s\S]+catalog product and applied to the order/);
assert.match(serverSource, /invalidateFulfillmentConsoleSnapshot\(\[order\.id\]\)/);
assert.match(uiSource, /Edit imported order SKU/);
assert.match(uiSource, /Search or enter the DataPlus SKU/);
assert.match(uiSource, /Manual SKU correction from order detail/);
assert.match(uiSource, /Reason for correction \(optional\)/);

console.log("Order SKU correction regression checks passed.");
