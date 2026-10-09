const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSettings, matchingRules, selectRate, batchStatus, legacyPackSkuCandidate, legacyPackSkuMatchesProduct, resolvePackage } = require("../lib/fulfillment-operations");

test("fulfillment settings clamp batch and chunk limits", () => {
  const settings = normalizeSettings({ maxOrdersPerBatch: 500, processingChunkSize: 0 });
  assert.equal(settings.maxOrdersPerBatch, 100);
  assert.equal(settings.processingChunkSize, 10);
  assert.equal(settings.requireScanToPack, false);
});

test("carrier settings seed services and preserve enablement choices", () => {
  const defaults = normalizeSettings({});
  const ups = defaults.carriers.find((carrier) => carrier.id === "ups");
  assert.equal(ups.enabled, true);
  assert.ok(ups.services.some((service) => service.name === "UPS Ground" && service.enabled));

  const configured = normalizeSettings({ carriers: [{ id: "ups", enabled: false, services: [{ id: "ups-ground", name: "UPS Ground", enabled: false }] }] });
  const configuredUps = configured.carriers.find((carrier) => carrier.id === "ups");
  assert.equal(configuredUps.enabled, false);
  assert.equal(configuredUps.services.find((service) => service.name === "UPS Ground").enabled, false);
  assert.ok(configuredUps.services.some((service) => service.name === "UPS 2nd Day Air"), "new default services remain available after an older settings record is loaded");
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

test("disabled carrier services are excluded from automatic rate selection", () => {
  const settings = normalizeSettings({ carriers: [{ id: "fedex", services: [{ id: "fedex-ground", name: "FedEx Ground", enabled: false }] }] });
  const result = selectRate([
    { id: "fedex", carrier: "FedEx", service: "FEDEX_GROUND", amount: 5, deliveryDays: 2 },
    { id: "ups", carrier: "UPS", service: "UPS Ground", amount: 8, deliveryDays: 3 }
  ], settings, {}, {});
  assert.equal(result.rate.id, "ups");
});

test("FedEx Ground Economy is available and can be disabled using its carrier rate code", () => {
  const defaults = normalizeSettings({});
  const fedex = defaults.carriers.find((carrier) => carrier.id === "fedex");
  assert.ok(fedex.services.some((service) => service.name === "FedEx Ground Economy" && service.enabled));

  const settings = normalizeSettings({ carriers: [{ id: "fedex", services: [{ id: "fedex-ground-economy", name: "FedEx Ground Economy", enabled: false }] }] });
  const result = selectRate([
    { id: "economy", carrier: "FedEx", service: "FEDEX_GROUND_ECONOMY", amount: 5, deliveryDays: 5 },
    { id: "ground", carrier: "FedEx", service: "FEDEX_GROUND", amount: 8, deliveryDays: 2 }
  ], settings, {}, {});
  assert.equal(result.rate.id, "ground");
});

test("non-merchandise USPS services are never offered or restored from saved settings", () => {
  const settings = normalizeSettings({ carriers: [{ id: "usps", services: ["USPS Media Mail", "USPS Bound Printed Matter"] }] });
  const usps = settings.carriers.find((carrier) => carrier.id === "usps");
  assert.equal(usps.services.some((service) => /media mail|bound printed matter/i.test(service.name)), false);
  const result = selectRate([
    { id: "bound", carrier: "USPS", service: "USPS Bound Printed Matter", amount: 2, deliveryDays: 7 },
    { id: "media", carrier: "USPS", service: "USPS Media Mail", amount: 3, deliveryDays: 6 },
    { id: "ground", carrier: "USPS", service: "USPS Ground Advantage", amount: 5, deliveryDays: 4 }
  ], settings, {}, {});
  assert.equal(result.rate.id, "ground");
});

test("batch status preserves partial failures as warnings", () => {
  assert.equal(batchStatus([{ status: "purchased" }, { status: "failed" }], "purchase"), "warning");
  assert.equal(batchStatus([{ status: "purchased" }, { status: "purchased" }], "purchase"), "completed");
  assert.equal(batchStatus([{ status: "rated" }, { status: "superseded" }]), "completed");
  assert.equal(batchStatus([{ status: "purchased" }, { status: "superseded" }], "purchase"), "completed");
  assert.equal(batchStatus([{ status: "processing" }], "purchase"), "running");
  assert.equal(batchStatus([{ status: "purchased" }, { status: "label_pending" }], "purchase"), "waiting_for_labels");
});

test("package fallback uses one complete measurement source", () => {
  const routes = [{ sku: "SKU-1", qty: 2 }];
  const product = { sku: "SKU-1", packageLength: 12, packageWidth: 8, packageHeight: 4, packageWeight: 3, itemLength: 10, itemWidth: 6, itemHeight: 2, itemWeight: 2 };
  assert.deepEqual(resolvePackage({}, routes, [product]), {
    package: { packageLength: 10, packageWidth: 6, packageHeight: 2, packageWeight: 4 },
    source: "product_item",
    inferred: true,
    productSku: "SKU-1"
  });
  const repaired = resolvePackage({ package: { packageLength: 9 } }, routes, [product]);
  assert.equal(repaired.source, "product_item");
  assert.deepEqual(repaired.package, { packageLength: 10, packageWidth: 6, packageHeight: 2, packageWeight: 4 });
});

test("ordinary sell units use item measurements instead of supplier case measurements", () => {
  const result = resolvePackage({}, [{ sku: "BUS246732TRV", qty: 1 }], [{
    sku: "BUS246732TRV",
    packageLength: 8,
    packageWidth: 8,
    packageHeight: 10,
    packageWeight: 11.4,
    itemLength: 2.25,
    itemWidth: 4,
    itemHeight: 10,
    itemWeight: 1.9
  }]);
  assert.equal(result.source, "product_item");
  assert.deepEqual(result.package, { packageLength: 2.25, packageWidth: 4, packageHeight: 10, packageWeight: 1.9 });
});

test("manually saved package defaults override stale supplier item measurements", () => {
  const result = resolvePackage({}, [{ sku: "BUSPGC14119SPR", qty: 1 }], [{
    sku: "BUSPGC14119SPR",
    packageLength: 10,
    packageWidth: 6,
    packageHeight: 4,
    packageWeight: 8,
    packageDimensionsLocked: true,
    itemLength: 18.74,
    itemWidth: 12.52,
    itemHeight: 11.732,
    itemWeight: 49.199
  }]);
  assert.equal(result.source, "product_manual_default");
  assert.deepEqual(result.package, { packageLength: 10, packageWidth: 6, packageHeight: 4, packageWeight: 8 });
});

test("disabling the package override returns shipping to product dimensions", () => {
  const result = resolvePackage({}, [{ sku: "DEFAULT-ITEM", qty: 1 }], [{
    sku: "DEFAULT-ITEM",
    itemLength: 11,
    itemWidth: 5,
    itemHeight: 2.75,
    itemWeight: 4,
    packageLength: 24,
    packageWidth: 18,
    packageHeight: 12,
    packageWeight: 48,
    packageDimensionsLocked: true,
    shippingPackageOverride: false
  }]);
  assert.equal(result.source, "product_item");
  assert.deepEqual(result.package, { packageLength: 11, packageWidth: 5, packageHeight: 2.75, packageWeight: 4 });
});

test("supplier pack normalization cannot replace preserved individual measurements", () => {
  const result = resolvePackage({}, [{ sku: "BUS172083TRV", qty: 1, inventoryMultiplier: 1 }], [{
    sku: "BUS172083TRV",
    uomQty: 120,
    minQuantity: 120,
    quantityIncrements: 120,
    itemLength: 48,
    itemWidth: 40,
    itemHeight: 57,
    itemWeight: 1980,
    packageLength: 48,
    packageWidth: 40,
    packageHeight: 57,
    packageWeight: 1980,
    productManagerFields: {
      original: {
        item_length: "13.00",
        item_width: "2.00",
        item_height: "24.00",
        item_weight: "14.08"
      }
    }
  }]);
  assert.equal(result.source, "product_item");
  assert.deepEqual(result.package, { packageLength: 13, packageWidth: 2, packageHeight: 24, packageWeight: 14.08 });
});

test("explicit shadow packs scale item measurements without using the supplier case", () => {
  const result = resolvePackage({}, [{ sku: "BUS163679TRV", qty: 1, inventoryMultiplier: 3 }], [{
    sku: "BUS163679TRV",
    uomQty: 12,
    itemLength: 11,
    itemWidth: 5,
    itemHeight: 2.75,
    itemWeight: 4,
    packageLength: 23,
    packageWidth: 11,
    packageHeight: 9,
    packageWeight: 48
  }]);
  assert.equal(result.source, "shadow_pack_item");
  assert.deepEqual(result.package, { packageLength: 11, packageWidth: 8.25, packageHeight: 5, packageWeight: 12 });
});

test("supplier case measurements normalize to one unit before shadow pack scaling", () => {
  const product = {
    sku: "BUS76655RJS",
    uom: "CS",
    uomQty: 12,
    packageLength: 9.38,
    packageWidth: 7.94,
    packageHeight: 7.31,
    packageWeight: 7.46
  };
  const single = resolvePackage({}, [{ sku: "BUS76655RJS", qty: 1 }], [product]);
  assert.equal(single.source, "product_case_unit");
  assert.deepEqual(single.package, {
    packageLength: 0.78,
    packageWidth: 0.66,
    packageHeight: 0.61,
    packageWeight: 0.622
  });

  const shadow = resolvePackage({ package: { packageLength: 5, packageWidth: 5, packageHeight: 5, packageWeight: 1 } }, [{ sku: "BUS76655RJS", qty: 1, inventoryMultiplier: 3 }], [product]);
  assert.equal(shadow.source, "shadow_pack_case_unit");
  assert.deepEqual(shadow.package, {
    packageLength: 1.83,
    packageWidth: 0.78,
    packageHeight: 0.66,
    packageWeight: 1.865
  });

  const manual = resolvePackage({
    packageMeasurementSource: "manual",
    package: { packageLength: 8, packageWidth: 6, packageHeight: 4, packageWeight: 2 }
  }, [{ sku: "BUS76655RJS", qty: 1, inventoryMultiplier: 3 }], [product]);
  assert.equal(manual.source, "order_package");
  assert.deepEqual(manual.package, { packageLength: 8, packageWidth: 6, packageHeight: 4, packageWeight: 2 });
});

test("known weight supplies temporary dimensions through 126 pounds", () => {
  assert.deepEqual(resolvePackage({ package: { packageWeight: 9 } }, [], []).package, { packageWeight: 9, packageLength: 3, packageWidth: 3, packageHeight: 3 });
  assert.deepEqual(resolvePackage({ package: { packageWeight: 19 } }, [], []).package, { packageWeight: 19, packageLength: 5, packageWidth: 5, packageHeight: 5 });
  assert.deepEqual(resolvePackage({ package: { packageWeight: 35 } }, [], []).package, { packageWeight: 35, packageLength: 10, packageWidth: 10, packageHeight: 10 });
  assert.deepEqual(resolvePackage({ package: { packageWeight: 70 } }, [], []).package, { packageWeight: 70, packageLength: 10, packageWidth: 10, packageHeight: 15 });
  assert.deepEqual(resolvePackage({ package: { packageWeight: 95 } }, [], []).package, { packageWeight: 95, packageLength: 10, packageWidth: 15, packageHeight: 15 });
  assert.deepEqual(resolvePackage({ package: { packageWeight: 120 } }, [], []).package, { packageWeight: 120, packageLength: 15, packageWidth: 15, packageHeight: 15 });
  assert.deepEqual(resolvePackage({ package: { packageWeight: 126 } }, [], []).package, { packageWeight: 126, packageLength: 20, packageWidth: 20, packageHeight: 15 });
  assert.equal(resolvePackage({ package: { packageWeight: 127 } }, [], []).package.packageLength, undefined);
});

test("manual shipment package works before the SKU exists in the catalog", () => {
  const result = resolvePackage({}, [{
    id: "unresolved-route",
    sku: "CHANNEL-SKU-NOT-CREATED",
    qty: 1,
    packageMeasurementSource: "manual",
    package: { packageLength: 12, packageWidth: 8, packageHeight: 4, packageWeight: 3.5 }
  }], []);
  assert.equal(result.source, "order_package");
  assert.equal(result.inferred, false);
  assert.deepEqual(result.package, { packageLength: 12, packageWidth: 8, packageHeight: 4, packageWeight: 3.5 });
});

test("missing actual weight falls back to dimensional weight", () => {
  const itemDimensions = resolvePackage({}, [{ sku: "ITEM", qty: 2 }], [{ sku: "ITEM", itemLength: 10, itemWidth: 10, itemHeight: 10 }]);
  assert.equal(itemDimensions.source, "product_item_dimensional_weight");
  assert.equal(itemDimensions.package.packageWeight, 14.388);
  assert.deepEqual([itemDimensions.package.packageLength, itemDimensions.package.packageWidth, itemDimensions.package.packageHeight], [10, 10, 10]);

  const packageDimensions = resolvePackage({}, [{ sku: "PACKAGE", qty: 1 }], [{ sku: "PACKAGE", shippingPackageOverride: true, packageLength: 10, packageWidth: 10, packageHeight: 10 }]);
  assert.equal(packageDimensions.source, "product_manual_default");
  assert.equal(packageDimensions.package.packageWeight, 7.194);

  const disabledPackage = resolvePackage({}, [{ sku: "PACKAGE-OFF", qty: 1 }], [{ sku: "PACKAGE-OFF", shippingPackageOverride: false, packageLength: 10, packageWidth: 10, packageHeight: 10, packageWeight: 8 }]);
  assert.equal(disabledPackage.source, "product_package_fallback");
  assert.deepEqual(disabledPackage.package, { packageLength: 10, packageWidth: 10, packageHeight: 10, packageWeight: 8 });

  const itemFirst = resolvePackage({}, [{ sku: "ITEM-FIRST", qty: 1 }], [{
    sku: "ITEM-FIRST",
    shippingPackageOverride: false,
    itemLength: 4,
    itemWidth: 3,
    itemHeight: 2,
    itemWeight: 1,
    packageLength: 20,
    packageWidth: 15,
    packageHeight: 10,
    packageWeight: 12
  }]);
  assert.equal(itemFirst.source, "product_item");
  assert.deepEqual(itemFirst.package, { packageLength: 4, packageWidth: 3, packageHeight: 2, packageWeight: 1 });
});

test("multi-SKU orders combine product weights and use the weight dimension rule", () => {
  const result = resolvePackage({}, [
    { sku: "FIRST", qty: 2 },
    { sku: "SECOND", qty: 1 }
  ], [
    { sku: "FIRST", itemWeight: 4 },
    { sku: "SECOND", itemWeight: 5 }
  ]);
  assert.equal(result.source, "combined_weight_dimensions");
  assert.deepEqual(result.package, { packageWeight: 13, packageLength: 5, packageWidth: 5, packageHeight: 5 });

  const incomplete = resolvePackage({}, [{ sku: "FIRST", qty: 1 }, { sku: "MISSING", qty: 1 }], [{ sku: "FIRST", itemWeight: 4 }]);
  assert.equal(incomplete.package.packageWeight, undefined);
});

test("package fallback resolves an ordered alias to its parent product", () => {
  const result = resolvePackage({}, [{ sku: "BUS21696RJS-4PC", qty: 1 }], [{
    sku: "BUS21696RJS",
    aliases: [{ aliasSku: "BUS21696RJS-4PC", active: true }],
    itemLength: 8,
    itemWidth: 4,
    itemHeight: 3,
    itemWeight: 2,
    packageLength: 13.1,
    packageWidth: 13.1,
    packageHeight: 13,
    packageWeight: 37
  }]);
  assert.equal(result.productSku, "BUS21696RJS");
  assert.equal(result.orderedSku, "BUS21696RJS-4PC");
  assert.equal(result.isAlias, true);
  assert.equal(result.source, "product_item");
  assert.equal(result.package.packageWeight, 2);
});

test("legacy supplier pack SKUs identify their managed parent and quantity", () => {
  assert.deepEqual(legacyPackSkuCandidate("BUS77401RJS-6000PC"), {
    parentSku: "BUS77401RJS",
    quantity: 6000,
    orderedSku: "BUS77401RJS-6000PC"
  });
  assert.equal(legacyPackSkuMatchesProduct("BUS77401RJS-6000PC", "BUS77401RJS", 6000), true);
  assert.equal(legacyPackSkuMatchesProduct("BUS77401RJS-4PC", "BUS77401RJS", 6000), false);
  assert.equal(legacyPackSkuCandidate("BUS77401RJS"), null);
});
