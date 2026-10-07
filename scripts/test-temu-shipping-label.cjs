const assert = require("node:assert/strict");
const { extractTemuPackageSns, mappedChannelWarehouse, normalizeTemuWarehouse, temuShipmentConfirmRequest } = require("../server");

assert.deepEqual(extractTemuPackageSns({
  result: { packageSnList: ["PK-4201027867771652045"] },
  success: true
}), ["PK-4201027867771652045"]);

assert.deepEqual(extractTemuPackageSns({
  result: { packageSnList: ["PK-1", "PK-2"], packageSn: "PK-1" }
}), ["PK-1", "PK-2"]);

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

console.log("Temu shipping-label package parsing tests passed.");
