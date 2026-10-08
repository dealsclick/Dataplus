const assert = require("node:assert/strict");
const { packageDimensionsChanged, applyManualPackageDimensions, applyShippingPreferences } = require("../lib/product-dimensions");

const product = { packageLength: 10, packageWidth: 8, packageHeight: 4, packageWeight: 2 };
assert.equal(packageDimensionsChanged(product, { packageLength: 10, packageWeight: 2 }), false);
assert.equal(packageDimensionsChanged(product, { packageLength: 12 }), true);

applyManualPackageDimensions(product, {
  packageLength: 12,
  packageWidth: 9,
  packageHeight: 5,
  packageWeight: 3.5,
}, "Luis", "2026-10-07T12:00:00.000Z");

assert.deepEqual(product, {
  packageLength: 12,
  packageWidth: 9,
  packageHeight: 5,
  packageWeight: 3.5,
  packageDimensionsLocked: true,
  shippingPackageOverride: true,
  packageDimensionsSource: "manual",
  packageDimensionsSavedAt: "2026-10-07T12:00:00.000Z",
  packageDimensionsSavedBy: "Luis",
});

applyShippingPreferences(product, { shippingPackageOverride: false, shipAlone: true }, "Shipping manager", "2026-10-08T12:00:00.000Z");
assert.equal(product.shippingPackageOverride, false);
assert.equal(product.packageDimensionsLocked, false);
assert.equal(product.shipAlone, true);
assert.equal(product.shippingPreferencesSavedBy, "Shipping manager");
assert.equal(product.shippingPreferencesSavedAt, "2026-10-08T12:00:00.000Z");

console.log("product dimension tests passed");
