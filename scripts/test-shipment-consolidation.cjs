const assert = require("node:assert/strict");
const {
  shipmentConsolidationEligibility,
  shipmentConsolidationPair,
  buildShipmentConsolidationIndex,
  assessConsolidatedPackages,
  assessManualPackage,
  manualPackagePlan,
  cartonizeShipment,
} = require("../lib/shipment-consolidation");

function order(overrides = {}) {
  return {
    id: `order-${Math.random()}`,
    orderNumber: "1001",
    source: "Walmart",
    status: "processing",
    financialStatus: "Authorized",
    buyer: "Customer Name",
    orderDate: "2026-10-09T02:56:00.000Z",
    address: { name: "Customer Name", line1: "1 Main St", line2: "Apt 2", city: "New York", state: "NY", postalCode: "10001", country: "US" },
    fulfillmentRoutes: [{ id: "route-1", type: "purchase", status: "pooled", warehouseId: "warehouse-2" }],
    ...overrides,
  };
}

const first = order({ id: "first", orderNumber: "53738" });
const second = order({ id: "second", orderNumber: "53739", orderDate: "2026-10-09T02:57:14.000Z" });
assert.equal(shipmentConsolidationEligibility(first).eligible, true, "purchase-bound inventory should be eligible before receiving");
assert.equal(shipmentConsolidationPair(first, second).eligible, true, "same customer/address/warehouse within 24 hours should match");

for (const source of ["Walmart", "Temu", "eBay", "Shopify", "Manual"]) {
  const channelFirst = order({ id: `${source}-first`, source, customerId: `${source}-customer` });
  const channelSecond = order({ id: `${source}-second`, source, customerId: `${source}-customer`, orderDate: "2026-10-09T03:01:00.000Z" });
  assert.equal(shipmentConsolidationPair(channelFirst, channelSecond).eligible, true, `${source} orders should support consolidation`);
}

const crossChannelFirst = order({ id: "cross-channel-first", source: "Walmart", customerId: "dataplus-customer-1" });
const crossChannelSecond = order({ id: "cross-channel-second", source: "Shopify", customerId: "dataplus-customer-1" });
assert.equal(shipmentConsolidationPair(crossChannelFirst, crossChannelSecond).eligible, true, "verified DataPlus customer IDs should match across channels");
assert.equal(shipmentConsolidationPair(
  order({ id: "marketplace-first", source: "Walmart", external: { buyerId: "buyer-1" } }),
  order({ id: "marketplace-second", source: "Temu", external: { buyerId: "buyer-1" } })
).eligible, false, "marketplace buyer IDs must remain channel-scoped");

const index = buildShipmentConsolidationIndex([first, second]);
assert.deepEqual(index.get("first").candidates.map((candidate) => candidate.orderId), ["second"]);
assert.deepEqual(index.get("second").candidates.map((candidate) => candidate.orderId), ["first"]);

assert.equal(shipmentConsolidationPair(first, order({ id: "wrong-unit", address: { ...first.address, line2: "Apt 3" } })).eligible, false);
assert.equal(shipmentConsolidationPair(first, order({ id: "wrong-warehouse", fulfillmentRoutes: [{ type: "warehouse", status: "allocated", warehouseId: "warehouse-3" }] })).eligible, false);
assert.equal(shipmentConsolidationPair(first, order({ id: "too-late", orderDate: "2026-10-10T03:00:01.000Z" })).eligible, false);
const liveWindow = { isLive: true, combineShippingWindows: [{ windowId: "live-window-1", status: "CLOSED", endDate: "2026-10-12T04:00:00.000Z" }] };
const liveFirst = order({ id: "live-first", source: "eBay", isEbayLive: true, salesOrigin: "ebay_live", ebayLive: liveWindow });
const liveSecond = order({ id: "live-second", source: "eBay", isEbayLive: true, salesOrigin: "ebay_live", ebayLive: liveWindow, orderDate: "2026-10-11T03:00:01.000Z" });
const livePair = shipmentConsolidationPair(liveFirst, liveSecond);
assert.equal(livePair.eligible, true, "matching eBay Live combine-shipping windows should remain eligible outside the normal time window");
assert.equal(livePair.matchSource, "ebay_live_shipping_window");
assert.equal(livePair.ebayLiveShippingWindowId, "live-window-1");
assert.equal(shipmentConsolidationPair(liveFirst, order({ ...liveSecond, id: "other-live-window", ebayLive: { isLive: true, combineShippingWindows: [{ windowId: "live-window-2" }] } })).eligible, false, "different eBay Live windows must not bypass the normal time limit");
assert.equal(shipmentConsolidationEligibility(order({ operationalStatus: "picked" })).eligible, false);
assert.equal(shipmentConsolidationEligibility(order({ fulfillmentRoutes: [{ type: "drop_ship", status: "open", warehouseId: "vendor" }] })).eligible, false);

const safePackages = assessConsolidatedPackages([
  { orderId: "first", packageGroupKey: "combined", labelReadiness: { weight: 4, length: 10, width: 8, height: 6 } },
  { orderId: "second", packageGroupKey: "combined", labelReadiness: { weight: 5, length: 11, width: 9, height: 7 } },
], ["first", "second"]);
assert.equal(safePackages.allowed, true);
assert.equal(safePackages.combinedWeight, 9);
assert.equal(safePackages.requiresPackageReview, true);

assert.equal(assessConsolidatedPackages([
  { orderId: "first", packageGroupKey: "combined", shipAlone: true, labelReadiness: { weight: 4, length: 10, width: 8, height: 6 } },
  { orderId: "second", packageGroupKey: "combined", labelReadiness: { weight: 5, length: 11, width: 9, height: 7 } },
], ["first", "second"]).allowed, false);

assert.equal(assessConsolidatedPackages([
  { orderId: "first", packageGroupKey: "combined", restrictedShipping: true, labelReadiness: { weight: 4, length: 10, width: 8, height: 6 } },
  { orderId: "second", packageGroupKey: "combined", labelReadiness: { weight: 5, length: 11, width: 9, height: 7 } },
], ["first", "second"]).allowed, false);

assert.equal(assessConsolidatedPackages([
  { orderId: "first", packageGroupKey: "combined", labelReadiness: { weight: 100, length: 10, width: 8, height: 6 } },
  { orderId: "second", packageGroupKey: "combined", labelReadiness: { weight: 51, length: 11, width: 9, height: 7 } },
], ["first", "second"]).allowed, false);

const cartonRows = [
  { orderId: "first", orderNumber: "53738", packageGroupKey: "combined", sku: "SKU-A", labelReadiness: { weight: 2, length: 4, width: 4, height: 4 } },
  { orderId: "second", orderNumber: "53739", packageGroupKey: "combined", sku: "SKU-B", labelReadiness: { weight: 2, length: 4, width: 4, height: 4 } },
];
const packageCatalog = [
  { id: "small", name: "Small box", packageType: "box", weight: 0.2, length: 8, width: 6, height: 4, maxWeight: 25 },
  { id: "medium", name: "Medium box", packageType: "box", weight: 0.45, length: 12, width: 10, height: 8, maxWeight: 50 },
];
const singleCarton = cartonizeShipment(cartonRows, ["first", "second"], packageCatalog, { dimensionalDivisor: 139 });
assert.equal(singleCarton.status, "single_carton");
assert.equal(singleCarton.cartons[0].packageId, "small");
assert.equal(singleCarton.cartons[0].physicalWeight, 4.2);
assert.equal(singleCarton.cartons[0].placements.length, 2);

const splitCartons = cartonizeShipment([
  { orderId: "first", packageGroupKey: "combined", sku: "SKU-A", labelReadiness: { weight: 5, length: 7, width: 5, height: 4 } },
  { orderId: "second", packageGroupKey: "combined", sku: "SKU-B", labelReadiness: { weight: 5, length: 7, width: 5, height: 4 } },
], ["first", "second"], [packageCatalog[0]], { dimensionalDivisor: 139 });
assert.equal(splitCartons.status, "split_required");
assert.equal(splitCartons.cartons.length, 2);

const manualCarton = cartonizeShipment([
  { orderId: "first", packageGroupKey: "combined", sku: "SKU-A", labelReadiness: { weight: 5, length: 20, width: 20, height: 20 } },
], ["first"], packageCatalog);
assert.equal(manualCarton.status, "manual_review");
assert.equal(manualCarton.unresolvedItemIds.length, 1);

const restrictedCarton = cartonizeShipment([
  { orderId: "first", packageGroupKey: "combined", sku: "SKU-A", shipAlone: true, labelReadiness: { weight: 2, length: 4, width: 4, height: 4 } },
], ["first"], packageCatalog);
assert.equal(restrictedCarton.status, "blocked");

const manualPackage = assessManualPackage({ packageWeight: 6.5, packageLength: 12, packageWidth: 9, packageHeight: 6 });
assert.equal(manualPackage.allowed, true);
assert.equal(manualPackage.billableWeight, 6.5);
assert.equal(assessManualPackage({ packageWeight: 6.5, packageLength: 12 }).allowed, false);
assert.equal(assessManualPackage({ packageWeight: 151, packageLength: 12, packageWidth: 9, packageHeight: 6 }).allowed, false);
const manualPlan = manualPackagePlan({ packageWeight: 6.5, packageLength: 12, packageWidth: 9, packageHeight: 6 });
assert.equal(manualPlan.status, "manual_package");
assert.equal(manualPlan.cartons[0].physicalWeight, 6.5);

console.log("Shipment consolidation tests passed.");
