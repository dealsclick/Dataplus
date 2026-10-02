const test = require("node:test");
const assert = require("node:assert/strict");
const { warehouseHasCompleteShipFromAddress, resolveShipFromWarehouse } = require("../server");

const si2 = {
  id: "warehouse-si2",
  code: "WH-SI2",
  name: "Staten Island 2",
  addressLine1: "388 South Ave",
  city: "Staten Island",
  state: "NY",
  postalCode: "10303",
  country: "US"
};

test("uses WH-SI2 when the selected warehouse has an incomplete ship-from address", () => {
  const db = { warehouses: [{ id: "vendor-dh", code: "DH", name: "D&H", country: "US" }, si2] };
  const resolved = resolveShipFromWarehouse(db, {}, "vendor-dh");
  assert.equal(resolved.warehouseId, si2.id);
  assert.equal(resolved.fallbackApplied, true);
  assert.match(resolved.fallbackReason, /D&H/);
});

test("keeps a selected warehouse that has a complete ship-from address", () => {
  const warehouse = { ...si2, id: "other", code: "WH-OTHER", name: "Other warehouse" };
  const resolved = resolveShipFromWarehouse({ warehouses: [warehouse, si2] }, {}, warehouse.id);
  assert.equal(warehouseHasCompleteShipFromAddress(warehouse), true);
  assert.equal(resolved.warehouseId, warehouse.id);
  assert.equal(resolved.fallbackApplied, false);
});

test("uses WH-SI2 when the requested warehouse no longer exists", () => {
  const resolved = resolveShipFromWarehouse({ warehouses: [si2] }, {}, "missing");
  assert.equal(resolved.warehouseId, si2.id);
  assert.equal(resolved.fallbackApplied, true);
});
