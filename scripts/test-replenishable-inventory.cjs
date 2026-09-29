const assert = require("assert");
const { resolveReplenishableInventory } = require("../lib/replenishable-inventory");

assert.deepStrictEqual(resolveReplenishableInventory({}, null, 8), { enabled: false, quantity: 0, source: "disabled" });
assert.deepStrictEqual(resolveReplenishableInventory({ replenishable: true, replenishableQty: 12 }, null, 8), { enabled: true, quantity: 12, source: "sku" });
assert.deepStrictEqual(resolveReplenishableInventory({ replenishable: true }, null, 8), { enabled: true, quantity: 8, source: "channel" });
assert.deepStrictEqual(resolveReplenishableInventory({ replenishable: true }, null, 0), { enabled: true, quantity: 1, source: "channel" });

const vendor = { inventoryRules: { replenishableEnabled: true, replenishableQty: 24 } };
assert.deepStrictEqual(resolveReplenishableInventory({ replenishableUseVendorRules: true }, vendor, 8), { enabled: true, quantity: 24, source: "vendor" });
assert.deepStrictEqual(resolveReplenishableInventory({ replenishable: true, replenishableQtyUseVendorDefault: true }, vendor, 8), { enabled: true, quantity: 24, source: "vendor" });
assert.deepStrictEqual(resolveReplenishableInventory({ replenishableUseVendorRules: true }, { inventoryRules: { replenishableEnabled: true } }, 8), { enabled: true, quantity: 8, source: "channel" });
assert.deepStrictEqual(resolveReplenishableInventory({ replenishableUseVendorRules: true, replenishable: true }, { inventoryRules: { replenishableEnabled: false, replenishableQty: 24 } }, 8), { enabled: false, quantity: 0, source: "disabled" });

console.log("Replenishable inventory tests passed.");
