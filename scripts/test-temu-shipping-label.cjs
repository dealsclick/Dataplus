const assert = require("node:assert/strict");
const { extractTemuPackageSns, firstTemuDocumentPayload, mappedChannelWarehouse, normalizeTemuWarehouse, shipmentLinesFromOrder, temuShipmentConfirmRequest, temuShipmentWarehouseId, temuVeeqoDuplicateLabelEvidence, trackingNumberFromShippingLabelText } = require("../server");

assert.deepEqual(extractTemuPackageSns({
  result: { packageSnList: ["PK-4201027867771652045"] },
  success: true
}), ["PK-4201027867771652045"]);

assert.deepEqual(extractTemuPackageSns({
  result: { packageSnList: ["PK-1", "PK-2"], packageSn: "PK-1" }
}), ["PK-1", "PK-2"]);

assert.deepEqual(firstTemuDocumentPayload({
  result: { shippingLabelUrlList: ["https://example.test/label.pdf"] },
  success: true
}), { shippingLabelUrl: "https://example.test/label.pdf" });

assert.equal(trackingNumberFromShippingLabelText("Ref PK-4200994549269252045-0 GFUS01076978083715", "GOFO"), "GFUS01076978083715");
assert.equal(trackingNumberFromShippingLabelText("Order PK-4201024957973252045-0 SWX268740000199769152", "SwiftX"), "SWX268740000199769152");
assert.equal(trackingNumberFromShippingLabelText("UPS tracking 1Z999AA10123456784", "UPS"), "1Z999AA10123456784");

assert.deepEqual(normalizeTemuWarehouse({
  warehouseId: "WH-03906098299012045",
  warehouseName: "linqusa",
  defaultWarehouse: true,
  enableBuyShippingLabel: true
}), {
  id: "WH-03906098299012045",
  name: "linqusa",
  isDefault: true,
  buyShippingEnabled: true,
  raw: {
    warehouseId: "WH-03906098299012045",
    warehouseName: "linqusa",
    defaultWarehouse: true,
    enableBuyShippingLabel: true
  }
});

assert.deepEqual(temuShipmentConfirmRequest({
  warehouseId: "WH-03906098299012045",
  carrierId: "960246690",
  trackingNumber: " 9341920111411272018939 ",
  orderSendInfoList: [{ orderSn: "211-1", quantity: 1 }]
}), {
  sendType: 0,
  sendRequestList: [{
    warehouseId: "WH-03906098299012045",
    carrierId: 960246690,
    trackingNumber: "9341920111411272018939",
    orderSendInfoList: [{ orderSn: "211-1", quantity: 1 }]
  }]
});

assert.deepEqual(mappedChannelWarehouse({ warehouses: [{
  id: "warehouse-2",
  channelWarehouseMappings: [{ channel: "Temu", externalWarehouseId: "WH-03906098299012045", externalWarehouseName: "linqusa", enabled: true }]
}] }, "warehouse-2", "temu"), {
  channel: "Temu",
  externalWarehouseId: "WH-03906098299012045",
  externalWarehouseName: "linqusa",
  enabled: true
});

assert.equal(temuShipmentWarehouseId({
  rate: { warehouseId: "WH-LIVE-RATE" },
  mappedWarehouseId: "warehouse-2",
  defaultWarehouseId: "WH-DEFAULT"
}), "WH-LIVE-RATE");

assert.equal(temuShipmentWarehouseId({
  rate: {},
  mappedWarehouseId: "WH-MAPPED",
  defaultWarehouseId: "WH-DEFAULT"
}), "WH-MAPPED");

assert.deepEqual(shipmentLinesFromOrder({ items: [
  { sku: "SKU-ONE", title: "First item", qty: 2 },
  { sku: "SKU-TWO", title: "Second item", qty: 4 }
] }, { lines: [{ lineIndex: 1, sku: "SKU-TWO", qty: 3 }] }), [{
  lineIndex: 1,
  sku: "SKU-TWO",
  title: "Second item",
  qty: 3,
  qtyAllocated: 3,
  qtyFulfilled: 0
}]);

assert.equal(temuVeeqoDuplicateLabelEvidence({ source: "Temu", shipments: [] }).blocked, false);
assert.deepEqual(temuVeeqoDuplicateLabelEvidence({
  source: "Temu",
  shipments: [{ provider: "temu", status: "fulfilled", trackingNumber: "9234690357260601393574" }]
}), {
  blocked: true,
  status: "",
  trackingNumbers: ["9234690357260601393574"],
  packageSnList: [],
  labelSources: ["temu"],
  reason: "Temu already has tracking 9234690357260601393574."
});
assert.equal(temuVeeqoDuplicateLabelEvidence({ source: "Temu", shipments: [] }, { status: "shipped" }).blocked, true);
assert.equal(temuVeeqoDuplicateLabelEvidence({
  source: "Temu",
  shipments: [{ provider: "veeqo", status: "label_purchased", documents: [{ documentType: "shipping_label" }] }]
}).blocked, true);
assert.equal(temuVeeqoDuplicateLabelEvidence({
  source: "Temu",
  shipments: [{ provider: "veeqo", status: "voided", trackingNumber: "VOIDED" }]
}).blocked, false);

console.log("Temu shipping-label package parsing tests passed.");
