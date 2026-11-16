const assert = require("node:assert/strict");

const {
  normalizeInventoryPurpose,
  normalizeLiveInventoryChannel,
  purchaseOrderPurposeForOrders,
  purchaseOrderPurposeForRecord,
  createManualPurchaseOrder,
  createPurchaseOrderFromOrders
} = require("../server");

function baseDb() {
  return {
    vendors: [{ id: "vendor-1", name: "True Value", status: "active" }],
    warehouses: [{ id: "warehouse-1", name: "Staten Island 2", isPhysical: true, allowReceiving: true }],
    purchaseOrders: [],
    orders: []
  };
}

assert.equal(normalizeInventoryPurpose("in stock"), "stock");
assert.equal(normalizeInventoryPurpose("orders"), "customer_orders");
assert.equal(normalizeInventoryPurpose("live orders"), "live_selling");
assert.equal(normalizeLiveInventoryChannel("TikTok Shop"), "tiktok_live");
assert.equal(normalizeLiveInventoryChannel("eBay Live"), "ebay_live");

assert.deepEqual(purchaseOrderPurposeForOrders([{ channelType: "shopify" }]), {
  inventoryPurpose: "customer_orders",
  liveChannel: ""
});
assert.deepEqual(purchaseOrderPurposeForOrders([{ isEbayLive: true }]), {
  inventoryPurpose: "live_selling",
  liveChannel: "ebay_live"
});
assert.deepEqual(purchaseOrderPurposeForOrders([{ salesOrigin: "tiktok_live" }]), {
  inventoryPurpose: "live_selling",
  liveChannel: "tiktok_live"
});

{
  const db = baseDb();
  const po = createManualPurchaseOrder(db, {
    vendorId: "vendor-1",
    warehouseId: "warehouse-1",
    items: [{ sku: "SKU-1", title: "Stock item", qty: 2, estimatedUnitCost: 10 }]
  });
  assert.equal(po.inventoryPurpose, "stock");
  assert.equal(po.inventoryPurposeLabel, "In stock");
  assert.equal(po.items[0].inventoryPurpose, "stock");
  assert.equal(po.items[0].liveChannel, "");
}

{
  const db = baseDb();
  assert.throws(() => createManualPurchaseOrder(db, {
    vendorId: "vendor-1",
    warehouseId: "warehouse-1",
    inventoryPurpose: "live_selling",
    items: [{ sku: "SKU-2", title: "Live item", qty: 1, estimatedUnitCost: 15 }]
  }), /Choose eBay Live or TikTok Live/);

  const po = createManualPurchaseOrder(db, {
    vendorId: "vendor-1",
    warehouseId: "warehouse-1",
    inventoryPurpose: "live_selling",
    liveChannel: "tiktok_live",
    items: [{ sku: "SKU-2", title: "Live item", qty: 1, estimatedUnitCost: 15 }]
  });
  assert.equal(po.inventoryPurpose, "live_selling");
  assert.equal(po.liveChannel, "tiktok_live");
  assert.equal(po.liveChannelLabel, "TikTok Live");
  assert.equal(po.items[0].inventoryPurpose, "live_selling");
  assert.equal(po.items[0].liveChannel, "tiktok_live");
  assert.deepEqual(purchaseOrderPurposeForRecord(po), {
    inventoryPurpose: "live_selling",
    inventoryPurposeLabel: "Live orders",
    liveChannel: "tiktok_live",
    liveChannelLabel: "TikTok Live"
  });
}

{
  const db = baseDb();
  db.orders = [
    { id: "order-ebay", orderNumber: "1", sku: "SKU-E", title: "eBay Live", qty: 1, isEbayLive: true },
    { id: "order-tiktok", orderNumber: "2", sku: "SKU-T", title: "TikTok Live", qty: 1, salesOrigin: "tiktok_live" }
  ];
  assert.throws(() => createPurchaseOrderFromOrders(db, ["order-ebay", "order-tiktok"]), /must use separate purchase orders/);
}

console.log("inventory purpose tests passed");
