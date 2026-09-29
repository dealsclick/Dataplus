const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { calculateReplenishableChannelInventory, replenishableSafeguard, resolveReplenishableInventory } = require("../lib/replenishable-inventory");

assert.deepStrictEqual(resolveReplenishableInventory({}, null, 8), { enabled: false, quantity: 0, source: "disabled" });
assert.deepStrictEqual(resolveReplenishableInventory({ replenishable: true, replenishableQty: 12 }, null, 8), { enabled: true, quantity: 12, source: "sku" });
assert.deepStrictEqual(resolveReplenishableInventory({ replenishable: true }, null, 8), { enabled: true, quantity: 8, source: "channel" });
assert.deepStrictEqual(resolveReplenishableInventory({ replenishable: true }, null, 0), { enabled: true, quantity: 1, source: "channel" });

const vendor = { inventoryRules: { replenishableEnabled: true, replenishableQty: 24 } };
assert.deepStrictEqual(resolveReplenishableInventory({ replenishableUseVendorRules: true }, vendor, 8), { enabled: true, quantity: 24, source: "vendor" });
assert.deepStrictEqual(resolveReplenishableInventory({ replenishable: true, replenishableQtyUseVendorDefault: true }, vendor, 8), { enabled: true, quantity: 24, source: "vendor" });
assert.deepStrictEqual(resolveReplenishableInventory({ replenishableUseVendorRules: true }, { inventoryRules: { replenishableEnabled: true } }, 8), { enabled: true, quantity: 8, source: "channel" });
assert.deepStrictEqual(resolveReplenishableInventory({ replenishableUseVendorRules: true, replenishable: true }, { inventoryRules: { replenishableEnabled: false, replenishableQty: 24 } }, 8), { enabled: false, quantity: 0, source: "disabled" });

assert.deepStrictEqual(resolveReplenishableInventory({ replenishable: true, replenishableQty: 12, replenishableChannels: ["shopify"] }, null, 8, { channel: "ebay" }), { enabled: false, quantity: 0, source: "channel_disabled", channels: ["shopify"] });
assert.deepStrictEqual(resolveReplenishableInventory({ replenishable: true, replenishableQty: 12, replenishableChannels: ["shopify"] }, null, 8, { channel: "shopify" }), { enabled: true, quantity: 12, source: "sku", channels: ["shopify"] });
assert.equal(replenishableSafeguard({ replenishable: true, active: false }, null, {}).reason, "SKU is inactive");
assert.equal(replenishableSafeguard({ replenishable: true, vendorAvailable: false }, null, {}).reason, "Vendor marked the SKU unavailable");
assert.equal(replenishableSafeguard({ replenishable: true, averageDaily30: 11 }, null, { replenishableMaxDailyVelocity: 10 }).reason, "30-day velocity 11.00 exceeds 10");
assert.equal(replenishableSafeguard({ replenishable: true, stockUpdatedAt: "2026-01-01T00:00:00.000Z" }, null, { replenishableFeedMaxAgeHours: 24 }, { now: Date.parse("2026-01-03T00:00:00.000Z") }).suspended, true);

assert.deepStrictEqual(calculateReplenishableChannelInventory({ product: { replenishable: true, replenishableQty: 80 }, settings: {}, channel: "shopify", physicalAvailable: 3, safetyQty: 50, maxQty: 25 }), {
  enabled: true, source: "sku", channels: [], physicalAvailable: 3, safetyQty: 0, targetQty: 80, maxQty: 25, finalQty: 25, suspended: false, reason: "", feedAt: ""
});
assert.equal(calculateReplenishableChannelInventory({ product: { replenishable: true, replenishableQty: 80, active: false }, settings: {}, channel: "shopify", physicalAvailable: 3 }).finalQty, 0);
assert.equal(fs.readFileSync(path.join(__dirname, "../server.js"), "utf8").includes("syncReplenishableWarehouseStock"), false, "replenishable policy must not create physical warehouse stock");

console.log("Replenishable inventory tests passed.");
