const assert = require("node:assert/strict");
const {
  createSupplierPurchaseOrdersFromOrders,
  movePurchaseOrderLineToDropship,
  supplierDropshipConversionPlan,
  vendorPurchaseFulfillmentMode,
} = require("../server");

function order(id, number, routeId) {
  return {
    id,
    orderNumber: number,
    status: "paid",
    address: { name: `Customer ${number}`, line1: `${number} Main St`, city: "New York", state: "NY", postalCode: "10001", country: "US" },
    items: [{ sku: "SKU-1", title: "Test item", qty: 1, unitCost: 5 }],
    fulfillmentRoutes: [{ id: routeId, type: "drop_ship", status: "pooled", lineIndex: 0, sku: "SKU-1", title: "Test item", qty: 1, unitCost: 5, vendorId: "vendor-dh", vendorName: "D&H" }],
    workflowEvents: [],
  };
}

const dropshipVendor = { id: "vendor-dh", name: "D&H", status: "active", purchaseOrderRules: { fulfillmentMode: "dropship_per_order", dropShipEnabled: true, requireBuyerApproval: true } };
assert.equal(vendorPurchaseFulfillmentMode(dropshipVendor), "dropship_per_order");
assert.equal(vendorPurchaseFulfillmentMode({ purchaseOrderRules: {} }), "pooled");

const first = order("order-1", "1001", "route-1");
const second = order("order-2", "1002", "route-2");
const dropshipDb = { orders: [first, second], vendors: [dropshipVendor], warehouses: [], purchaseOrders: [], purchaseRequirements: [], sequence: {} };
const created = createSupplierPurchaseOrdersFromOrders(dropshipDb, [first.id, second.id], { user: "Test" });
assert.equal(created.purchaseOrders.length, 2, "dropship mode creates one PO per customer order");
assert.ok(created.purchaseOrders.every((po) => po.fulfillmentMode === "dropship_per_order"));
assert.ok(created.purchaseOrders.every((po) => po.orderIds.length === 1));
assert.notDeepEqual(created.purchaseOrders[0].shipTo, created.purchaseOrders[1].shipTo, "customer ship-to addresses remain isolated");
assert.equal(first.fulfillmentRoutes[0].purchaseOrderId !== second.fulfillmentRoutes[0].purchaseOrderId, true);

const missingAddress = order("order-4", "1004", "route-4");
missingAddress.address.postalCode = "";
assert.throws(
  () => createSupplierPurchaseOrdersFromOrders({ orders: [missingAddress], vendors: [dropshipVendor], warehouses: [], purchaseOrders: [], purchaseRequirements: [], sequence: {} }, [missingAddress.id], { user: "Test" }),
  /complete delivery address/
);

const pooledVendor = { id: "vendor-pool", name: "Pooled Supplier", status: "active", purchaseOrderRules: { fulfillmentMode: "pooled", dropShipEnabled: true, requireBuyerApproval: true } };
const pooledOrder = order("order-3", "1003", "route-3");
pooledOrder.fulfillmentRoutes[0].type = "purchase";
pooledOrder.fulfillmentRoutes[0].vendorId = pooledVendor.id;
pooledOrder.fulfillmentRoutes[0].vendorName = pooledVendor.name;
pooledOrder.fulfillmentRoutes[0].purchaseOrderId = "po-source";
pooledOrder.fulfillmentRoutes[0].purchaseOrderNumber = "PO#1001";
const sourcePo = {
  id: "po-source", poNumber: "PO#1001", status: "draft", type: "customer_demand", fulfillmentMode: "pooled",
  vendorId: pooledVendor.id, supplier: pooledVendor.name, warehouseId: "warehouse-1", warehouseName: "Main",
  orderIds: [pooledOrder.id], orderNumbers: [pooledOrder.orderNumber],
  items: [{ sku: "SKU-1", title: "Test item", qty: 1, unitCost: 5, orderId: pooledOrder.id, orderNumber: pooledOrder.orderNumber, routeId: "route-3" }],
  timeline: [], receipts: [],
};
const moveDb = { orders: [pooledOrder], vendors: [pooledVendor], purchaseOrders: [sourcePo], purchaseRequirements: [{ id: "req-1", routeId: "route-3", status: "converted", purchaseOrderId: sourcePo.id }], sequence: { po: 1001 } };
const moved = movePurchaseOrderLineToDropship(moveDb, sourcePo, { routeId: "route-3", reasonCode: "expedited_shipment", user: "Test" });
assert.equal(moved.dropshipPurchaseOrder.fulfillmentMode, "dropship_per_order");
assert.equal(moved.dropshipPurchaseOrder.orderIds.length, 1);
assert.equal(sourcePo.status, "superseded");
assert.equal(pooledOrder.fulfillmentRoutes[0].type, "drop_ship");
assert.equal(pooledOrder.fulfillmentRoutes[0].purchaseOrderId, moved.dropshipPurchaseOrder.id);
assert.equal(moveDb.purchaseRequirements[0].purchaseOrderId, moved.dropshipPurchaseOrder.id);
const dropshipEvent = moved.dropshipPurchaseOrder.timeline.find((event) => event.type === "dropship_line_moved");
assert.equal(dropshipEvent.reasonCode, "expedited_shipment");
assert.equal(dropshipEvent.reasonLabel, "Expedited shipment");
assert.equal(dropshipEvent.reasonNote, "");

const secondLineRoute = { id: "route-5", type: "purchase", status: "waiting_for_po", lineIndex: 1, sku: "SKU-2", title: "Second item", qty: 2, unitCost: 3, vendorId: pooledVendor.id, vendorName: pooledVendor.name, purchaseOrderId: "po-source-2", purchaseOrderNumber: "PO#1002" };
pooledOrder.items.push({ sku: "SKU-2", title: "Second item", qty: 2, unitCost: 3 });
pooledOrder.fulfillmentRoutes.push(secondLineRoute);
const secondSourcePo = { ...sourcePo, id: "po-source-2", poNumber: "PO#1002", status: "draft", workflowStage: "waiting_for_po", replacedByPurchaseOrderId: "", replacedByPurchaseOrderNumber: "", items: [{ sku: "SKU-2", title: "Second item", qty: 2, unitCost: 3, orderId: pooledOrder.id, orderNumber: pooledOrder.orderNumber, routeId: "route-5" }], timeline: [] };
moveDb.purchaseOrders.push(secondSourcePo);
const movedSecond = movePurchaseOrderLineToDropship(moveDb, secondSourcePo, { routeId: "route-5", user: "Test" });
assert.equal(movedSecond.dropshipPurchaseOrder.id, moved.dropshipPurchaseOrder.id, "lines for one customer order reuse its dropship PO");
assert.equal(movedSecond.dropshipPurchaseOrder.items.length, 2);
const secondDropshipEvent = movedSecond.dropshipPurchaseOrder.timeline.filter((event) => event.type === "dropship_line_moved").at(-1);
assert.equal(secondDropshipEvent.reasonCode, "other_operational", "missing reason code uses a safe audit default");
assert.equal(secondDropshipEvent.reasonNote, "", "a typed note is not required");

const previewOrder = order("order-6", "1006", "route-6");
previewOrder.fulfillmentRoutes[0].type = "purchase";
previewOrder.fulfillmentRoutes[0].vendorId = pooledVendor.id;
previewOrder.fulfillmentRoutes[0].vendorName = pooledVendor.name;
previewOrder.fulfillmentRoutes[0].purchaseOrderId = "po-preview";
const previewPo = { id: "po-preview", poNumber: "PO#1003", status: "draft", type: "customer_demand", fulfillmentMode: "pooled", vendorId: pooledVendor.id, supplier: pooledVendor.name, items: [{ sku: "SKU-1", qty: 1, orderId: previewOrder.id, orderNumber: previewOrder.orderNumber, routeId: "route-6" }] };
const plan = supplierDropshipConversionPlan({ orders: [previewOrder], purchaseOrders: [previewPo] }, pooledVendor);
assert.equal(plan.summary.eligibleLines, 1);
assert.equal(plan.summary.eligibleOrders, 1);

console.log("Dropship purchasing tests passed.");
