const assert = require("node:assert/strict");

const {
  createSupplierPurchaseOrdersFromOrders,
  linkCustomerOrdersToPurchaseOrder,
  repairStalePurchaseDemandLinks,
  reopenPurchaseRequirementsForPurchaseOrder
} = require("../server");

function orderFixture(id, orderNumber, sku, options = {}) {
  return {
    id,
    orderNumber,
    status: "processing",
    items: [{ sku, title: sku, qty: options.qty || 1 }],
    fulfillmentRoutes: options.routes || [],
    purchaseOrderIds: options.purchaseOrderIds || [],
    purchaseOrderNumbers: options.purchaseOrderNumbers || [],
    workflowEvents: []
  };
}

function purchaseRoute(id, sku, purchaseOrder = null) {
  return {
    id,
    type: "purchase",
    status: purchaseOrder ? "converted" : "pooled",
    lineIndex: 0,
    sku,
    qty: 1,
    vendorId: "true-value",
    vendorName: "True Value",
    ...(purchaseOrder ? { purchaseOrderId: purchaseOrder.id, purchaseOrderNumber: purchaseOrder.poNumber } : {})
  };
}

function baseDb() {
  return {
    vendors: [{ id: "true-value", name: "True Value", status: "active", purchaseOrderRules: { defaultWarehouseId: "si2" } }],
    warehouses: [{ id: "si2", name: "Staten Island 2", type: "physical", active: true, default: true }],
    purchaseRequirements: [],
    purchaseOrders: [],
    orders: [],
    systemSettings: {}
  };
}

{
  const db = baseDb();
  const deletedPo = { id: "deleted-po", poNumber: "PO#136755", status: "deleted" };
  const activePo = { id: "active-po", poNumber: "PO#136765", status: "in_transit", ctechId: "136765", vendorId: "true-value", supplier: "True Value", warehouseId: "si2", warehouseName: "Staten Island 2", items: [{ sku: "BUS108090TRV-3PC", qty: 2 }], orderIds: [], orderNumbers: [], timeline: [] };
  const staleRoute = purchaseRoute("route-stale", "BUS108090TRV-3PC", deletedPo);
  delete staleRoute.purchaseOrderId;
  delete staleRoute.purchaseOrderNumber;
  const staleOrder = orderFixture("order-1", "89071", "BUS108090TRV-3PC", { routes: [staleRoute], purchaseOrderIds: [deletedPo.id], purchaseOrderNumbers: [deletedPo.poNumber] });
  const baseSkuOrder = orderFixture("order-2", "89356", "BUS108090TRV");
  db.orders = [staleOrder, baseSkuOrder];
  db.purchaseOrders = [activePo, deletedPo];
  db.purchaseRequirements = [{ id: "requirement-1", routeId: staleRoute.id, orderId: staleOrder.id, orderNumber: staleOrder.orderNumber, sku: staleRoute.sku, qty: 1, status: "converted", vendorId: "true-value", vendorName: "True Value", purchaseOrderId: deletedPo.id, purchaseOrderNumber: deletedPo.poNumber }];

  const result = linkCustomerOrdersToPurchaseOrder(db, activePo, db.orders, { user: "Test buyer" });
  assert.equal(result.linkedOrderCount, 2, "both exact and pack-parent demand should link");
  assert.equal(result.linkedLineCount, 2);
  assert.equal(activePo.items[0].qty, 2, "linking must not change supplier ordered quantity");
  assert.equal(activePo.items[0].purchaseDemandLinks.length, 2);
  assert.equal(db.purchaseRequirements[0].purchaseOrderId, activePo.id);
  assert.equal(staleOrder.fulfillmentRoutes[0].warehouseId, activePo.warehouseId);
  assert.equal(baseSkuOrder.fulfillmentRoutes[0].purchaseOrderId, activePo.id);
}

{
  const db = baseDb();
  const activePo = { id: "active-po", poNumber: "PO#200", status: "draft", type: "customer_demand", vendorId: "true-value", supplier: "True Value", warehouseId: "si2", items: [] };
  const route = purchaseRoute("route-restore", "BUS117551TRV");
  const order = orderFixture("order-restore", "89072", route.sku, { routes: [route] });
  db.orders = [order];
  db.purchaseOrders = [activePo];
  db.purchaseRequirements = [{ id: "req-restore", routeId: route.id, status: "converted", purchaseOrderId: activePo.id, purchaseOrderNumber: activePo.poNumber }];
  const repaired = repairStalePurchaseDemandLinks(db, [order], { user: "Test buyer" });
  assert.equal(repaired.orders.length, 1);
  assert.equal(route.purchaseOrderId, activePo.id, "a valid requirement should restore its route link instead of reopening demand");
  assert.equal(db.purchaseRequirements[0].status, "converted");
}

{
  const db = baseDb();
  const po = { id: "deleted-po", poNumber: "PO#300" };
  db.purchaseRequirements = [
    { id: "one", purchaseOrderId: po.id, purchaseOrderNumber: po.poNumber, status: "converted", convertedAt: "2026-01-01" },
    { id: "two", purchaseOrderNumber: po.poNumber.toLowerCase(), status: "converted" },
    { id: "other", purchaseOrderId: "different", status: "converted" }
  ];
  assert.equal(reopenPurchaseRequirementsForPurchaseOrder(db, po, { reason: "test cleanup", user: "Test buyer", now: "2026-11-11T12:00:00.000Z" }), 2);
  assert.equal(db.purchaseRequirements[0].status, "buyer_review");
  assert.equal(db.purchaseRequirements[0].purchaseOrderId, undefined);
  assert.equal(db.purchaseRequirements[2].purchaseOrderId, "different");
}

{
  const db = baseDb();
  const po = { id: "po-warehouse-skip", poNumber: "PO#400", status: "draft", vendorId: "true-value", supplier: "True Value", warehouseId: "si2", items: [{ sku: "BUS154315TRV", qty: 1 }], timeline: [] };
  const warehouseOrder = orderFixture("order-warehouse", "89288", "BUS154315TRV", { routes: [{ id: "warehouse-route", type: "warehouse", status: "allocated", lineIndex: 0, qty: 1, warehouseId: "si2", warehouseName: "Staten Island 2" }] });
  db.orders = [warehouseOrder];
  db.purchaseOrders = [po];
  const result = linkCustomerOrdersToPurchaseOrder(db, po, db.orders, { user: "Test buyer" });
  assert.equal(result.linkedOrderCount, 0);
  assert.match(result.results[0].skippedLines[0].reason, /allocated/i);
  assert.equal(po.items[0].purchaseDemandLinks, undefined);
}

{
  const db = baseDb();
  const warehouseOrder = orderFixture("order-noop", "89288", "BUS154315TRV", { routes: [{ id: "warehouse-route", type: "warehouse", status: "allocated", lineIndex: 0, qty: 1, warehouseId: "si2", warehouseName: "Staten Island 2" }] });
  db.orders = [warehouseOrder];
  const result = createSupplierPurchaseOrdersFromOrders(db, [warehouseOrder.id], { user: "Test buyer" });
  assert.equal(result.purchaseOrders.length, 0, "an all-ineligible selection should return review feedback instead of throwing");
  assert.equal(result.skippedOrders.length, 1);
  assert.match(result.skippedOrders[0].reason, /allocated/i);
}

{
  const db = baseDb();
  const route = { ...purchaseRoute("route-moq", "BUS265368TRV"), uom: "EA", uomQty: 6, unitCost: 5.96 };
  const order = orderFixture("order-moq", "89431", route.sku, { routes: [route] });
  db.orders = [order];
  const result = createSupplierPurchaseOrdersFromOrders(db, [order.id], { user: "Test buyer" });
  const line = result.purchaseOrders[0].items[0];
  assert.equal(line.qty, 6, "supplier quantity should round customer demand up to the purchasing multiple");
  assert.equal(line.customerDemandQty, 1);
  assert.equal(line.purchaseMultiple, 6);
  assert.equal(line.purchaseSurplusQty, 5);
  assert.equal(line.purchaseDemandLinks[0].qty, 1, "the PO should retain the original customer demand separately from the supplier quantity");
}

console.log("Purchase-order demand linking checks passed.");
