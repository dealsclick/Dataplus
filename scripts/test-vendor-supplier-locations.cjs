const assert = require("assert");
const { normalizeSupplierLocations } = require("../lib/vendor-supplier-locations");
const { syncVendorFeedWarehouses } = require("../server");

const locations = normalizeSupplierLocations([
  { id: "east", code: "EAST", name: "East DC", sourceLocationIds: ["warehouse_01"], inventoryEnabled: true, dropshipEnabled: true, priority: 1, safetyQtyEnabled: true, safetyQty: 12 },
  { id: "west", code: "WEST", name: "West DC", sourceLocationIds: [], inventoryEnabled: true, priority: 2 }
], { vendorId: "vendor-1" });

const db = {
  vendors: [{ id: "vendor-1", name: "Example Supplier", code: "EX", status: "active", supplierLocations: locations }],
  warehouses: [],
  systemSettings: { vendorFeedSchedules: [] }
};

const first = syncVendorFeedWarehouses(db);
assert.equal(first.changed, true);
assert.equal(db.warehouses.length, 3, "aggregate plus two child locations should be retained");
const aggregate = db.warehouses.find((row) => row.managedByVendorFeed && !row.managedVendorLocation);
const east = db.warehouses.find((row) => row.vendorLocationId === "east");
const west = db.warehouses.find((row) => row.vendorLocationId === "west");
assert(aggregate, "aggregate supplier warehouse should exist");
assert.equal(east.parentWarehouseId, aggregate.id);
assert.equal(east.isPhysical, false);
assert.equal(east.allowReceiving, false);
assert.equal(east.isSellable, true, "mapped active supplier inventory may participate in availability");
assert.equal(east.locationSafetyQty, 12);
assert.equal(west.isSellable, false, "unmapped supplier locations must never invent sellable stock");

db.vendors[0].supplierLocations = [locations[0]];
syncVendorFeedWarehouses(db);
assert.equal(db.warehouses.find((row) => row.vendorLocationId === "west").status, "inactive", "removed locations are retained and deactivated");

assert.throws(() => normalizeSupplierLocations([
  { code: "DUP", name: "One" },
  { code: "dup", name: "Two" }
], { vendorId: "vendor-1" }), /Duplicate supplier location code/);

console.log("vendor supplier location tests passed");
