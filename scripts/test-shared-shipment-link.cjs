const assert = require("node:assert/strict");
const postgres = require("../db");
const { linkPurchasedShipmentToGroup } = require("../server");

async function main() {
  const originalReadOrderByKey = postgres.readOrderByKey;
  const originalReadOrdersByIds = postgres.readOrdersByIds;
  const originalSaveOrder = postgres.saveOrder;
  const saved = [];
  try {
    const persistedMaster = {
      id: "master",
      orderNumber: "88352",
      shipmentGroupId: "SG-TEST",
      shipmentGroupOrderIds: ["master", "child"],
      shipmentGroupWarehouseId: "warehouse-1",
      shipmentGroupPackage: { packageWeight: 5, packageLength: 10, packageWidth: 8, packageHeight: 6 },
    };
    const child = {
      id: "child",
      orderNumber: "88329",
      source: "eBay",
      shipmentGroupId: "SG-TEST",
      shipmentGroupOrderIds: ["master", "child"],
      items: [{ sku: "LIVE-SKU", qty: 1 }],
      fulfillmentRoutes: [{ id: "route-child", status: "allocated" }],
      shipments: [],
      documents: [],
    };
    postgres.readOrderByKey = async () => persistedMaster;
    postgres.readOrdersByIds = async () => [persistedMaster, child];
    postgres.saveOrder = async (order) => { saved.push(order); return order; };

    const staleMaster = { id: "master", orderNumber: "88352", items: [], documents: [] };
    const shipment = {
      id: "shipment-1",
      trackingNumber: "879601127269",
      carrierName: "FedEx",
      service: "Ground",
      shippingCost: 12,
      warehouseId: "warehouse-1",
      documents: [],
    };
    const result = await linkPurchasedShipmentToGroup(staleMaster, shipment, "Test");

    assert.equal(result.groupId, "SG-TEST");
    assert.equal(result.linked.length, 1);
    assert.deepEqual(shipment.groupOrderIds, ["master", "child"]);
    assert.equal(child.trackingNumber, "879601127269");
    assert.equal(child.shipments[0].masterOrderId, "master");
    assert.equal(child.shipments[0].sharedLabel, true);
    assert.equal(saved.length, 1);
  } finally {
    postgres.readOrderByKey = originalReadOrderByKey;
    postgres.readOrdersByIds = originalReadOrdersByIds;
    postgres.saveOrder = originalSaveOrder;
    await postgres.closePool().catch(() => {});
  }
}

main().then(() => console.log("Shared shipment link tests passed.")).catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
