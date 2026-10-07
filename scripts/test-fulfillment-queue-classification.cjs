const assert = require("node:assert/strict");
const { fulfillmentWorkRows } = require("../server");

const product = {
  id: "product-1",
  sku: "BUS163679TRV",
  title: "Test product",
  itemWeight: 4,
  itemLength: 11,
  itemWidth: 5,
  itemHeight: 2.75
};
const order = {
  id: "order-1",
  orderNumber: "45009",
  buyer: "Customer",
  address: { line1: "1 Main St", city: "Staten Island", state: "NY", postalCode: "10303", country: "US" },
  items: [{ sku: product.sku, title: product.title, qty: 1 }],
  inventoryAllocations: [],
  fulfillmentRoutes: [{
    id: "route-1",
    type: "warehouse",
    status: "unallocated",
    lineIndex: 0,
    productId: product.id,
    sku: product.sku,
    qty: 1,
    warehouseId: "warehouse-2",
    warehouseName: "Staten Island 2"
  }]
};

const [unallocated] = fulfillmentWorkRows([order], {}, [product], []);
assert.equal(unallocated.status, "ready_to_ship");
assert.equal(unallocated.allocationStatus, "unallocated");
assert.equal(unallocated.labelReadiness.ready, true);
assert.deepEqual(unallocated.labelReadiness.blockers, []);

const allocatedOrder = structuredClone(order);
allocatedOrder.fulfillmentRoutes[0].status = "allocated";
const [allocated] = fulfillmentWorkRows([allocatedOrder], {}, [product], []);
assert.equal(allocated.status, "ready_to_ship");
assert.equal(allocated.allocationStatus, "allocated");

const purchaseOrder = structuredClone(order);
purchaseOrder.fulfillmentRoutes[0] = {
  ...purchaseOrder.fulfillmentRoutes[0],
  id: "route-purchase",
  type: "purchase",
  status: "draft",
  purchaseOrderId: "po-draft"
};
const [purchase] = fulfillmentWorkRows([purchaseOrder], {}, [product], [{
  id: "po-draft",
  poNumber: "PO#1186",
  status: "draft",
  warehouseId: "warehouse-2",
  warehouseName: "Staten Island 2"
}]);
assert.equal(purchase.status, "ready_to_ship");
assert.equal(purchase.supplyStatus, "draft");
assert.equal(purchase.allocationStatus, "unallocated");
assert.equal(purchase.labelReadiness.ready, true);
assert.deepEqual(purchase.labelReadiness.blockers, []);

console.log("Fulfillment queue classification tests passed.");
