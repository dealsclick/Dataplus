const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSettings, matchingRules, selectRate, batchStatus, resolvePackage } = require("../lib/fulfillment-operations");

test("fulfillment settings clamp batch and chunk limits", () => {
  const settings = normalizeSettings({ maxOrdersPerBatch: 500, processingChunkSize: 0 });
  assert.equal(settings.maxOrdersPerBatch, 100);
  assert.equal(settings.processingChunkSize, 10);
  assert.equal(settings.requireScanToPack, false);
});

test("shipping rules honor warehouse, postal prefix, and order value", () => {
  const settings = normalizeSettings({ rules: [{ name: "Local premium", warehouseIds: ["WH-1"], destinationCountries: ["US"], postalPrefixes: ["103"], minOrderValue: 25, maxOrderValue: 100 }] });
  const order = { source: "Shopify", total: 50, address: { countryCode: "US", postalCode: "10303" } };
  assert.equal(matchingRules(settings, order, { warehouseId: "WH-1" }).length, 1);
  assert.equal(matchingRules(settings, { ...order, total: 10 }, { warehouseId: "WH-1" }).length, 0);
  assert.equal(matchingRules(settings, order, { warehouseId: "WH-2" }).length, 0);
});

test("shipping rules match channel, destination, and package weight", () => {
  const settings = normalizeSettings({ rules: [{ name: "Northeast ground", priority: 1, channels: ["Shopify"], destinationStates: ["NY", "NJ"], minWeight: 1, maxWeight: 70, carrier: "UPS", service: "Ground" }] });
  const order = { source: "Shopify", total: 50, address: { state: "NY", postalCode: "10303", country: "US" }, package: { packageWeight: 12 } };
  assert.equal(matchingRules(settings, order, { warehouseId: "WH" })[0].name, "Northeast ground");
  assert.equal(matchingRules(settings, { ...order, address: { ...order.address, state: "CA" } }, { warehouseId: "WH" }).length, 0);
});

test("preferred rule selects matching carrier and records conflicts", () => {
  const settings = normalizeSettings({ rules: [
    { id: "first", name: "UPS first", priority: 1, carrier: "UPS", service: "Ground", selection: "preferred" },
    { id: "second", name: "Fallback", priority: 2, selection: "cheapest" }
  ] });
  const rates = [
    { id: "usps", carrier: "USPS", service: "Ground Advantage", amount: 6, deliveryDays: 4 },
    { id: "ups", carrier: "UPS", service: "Ground", amount: 8, deliveryDays: 3 }
  ];
  const result = selectRate(rates, settings, {}, {});
  assert.equal(result.rate.id, "ups");
  assert.equal(result.rule.id, "first");
  assert.deepEqual(result.conflicts, [{ id: "second", name: "Fallback" }]);
});

test("batch status preserves partial failures as warnings", () => {
  assert.equal(batchStatus([{ status: "purchased" }, { status: "failed" }], "purchase"), "warning");
  assert.equal(batchStatus([{ status: "purchased" }, { status: "purchased" }], "purchase"), "completed");
  assert.equal(batchStatus([{ status: "processing" }], "purchase"), "running");
});

test("package fallback uses one complete measurement source", () => {
  const routes = [{ sku: "SKU-1", qty: 2 }];
  const product = { sku: "SKU-1", packageLength: 12, packageWidth: 8, packageHeight: 4, packageWeight: 3, itemLength: 10, itemWidth: 6, itemHeight: 2, itemWeight: 2 };
  assert.deepEqual(resolvePackage({}, routes, [product]), {
    package: { packageLength: 12, packageWidth: 8, packageHeight: 4, packageWeight: 6 },
    source: "product_package",
    inferred: true,
    productSku: "SKU-1"
  });
  assert.equal(resolvePackage({ package: { packageLength: 9 } }, routes, [product]).source, "incomplete_order_package");
});
