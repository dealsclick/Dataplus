const assert = require("node:assert/strict");

const {
  createSupplierPurchaseOrdersFromOrders,
  alignPurchaseOrderLinesToVendor,
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
  const route = { ...purchaseRoute("route-moq", "BUS265368TRV"), uom: "EA", uomQty: 1, quantityIncrements: 6, unitCost: 5.96 };
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

{
  const db = baseDb();
  const route = { ...purchaseRoute("route-pack", "BUS202637TRV"), uom: "PK", uomQty: 3, unitCost: 34.86 };
  const order = orderFixture("order-pack", "89954", route.sku, { routes: [route] });
  db.orders = [order];
  const result = createSupplierPurchaseOrdersFromOrders(db, [order.id], { user: "Test buyer" });
  const line = result.purchaseOrders[0].items[0];
  assert.equal(line.qty, 1, "a three-piece UOM should create one PO unit, not three PO units");
  assert.equal(line.uomQty, 3);
  assert.equal(line.purchaseMultiple, 1);
  assert.equal(line.purchaseUomLabel, "Pack of 3");
}

{
  const db = baseDb();
  const route = {
    ...purchaseRoute("route-stale-name", "BUS250602TRV"),
    vendorName: "Do It Best",
    vendorSku: "251746",
    unitCost: 9.34,
    supplierOffers: [
      { vendorId: "true-value", vendorName: "True Value", vendorSku: "250602", unitCost: 9.53 },
      { vendorId: "do-it-best", vendorName: "Do It Best", vendorSku: "251746", unitCost: 9.34 }
    ]
  };
  const order = orderFixture("order-stale-name", "90001", route.sku, { routes: [route] });
  db.orders = [order];
  const result = createSupplierPurchaseOrdersFromOrders(db, [order.id], { user: "Test buyer" });
  const po = result.purchaseOrders[0];
  assert.equal(po.supplier, "True Value", "the route vendor ID must remain authoritative for the PO");
  assert.equal(po.items[0].supplier, "True Value", "a stale route vendor name must not leak into a True Value PO line");
  assert.equal(po.items[0].vendorId, "true-value");
  assert.equal(po.items[0].vendorSku, "250602", "the PO line should use the selected supplier's offer SKU");
}

{
  const po = {
    items: [
      {
        sku: "BUS250602TRV",
        supplier: "Do It Best",
        vendorId: "do-it-best",
        vendorSku: "251746",
        unitCost: 9.34,
        supplierOffers: [{ vendorId: "true-value", vendorName: "True Value", vendorSku: "250602", unitCost: 9.53 }]
      },
      {
        sku: "BUS-NO-TV-OFFER",
        supplier: "Global",
        vendorId: "global",
        vendorSku: "GLOBAL-1",
        unitCost: 4.25,
        supplierOffers: [{ vendorId: "global", vendorName: "Global", vendorSku: "GLOBAL-1", unitCost: 4.25 }]
      },
      {
        sku: "BUS-EXISTING-TV",
        supplier: "True Value",
        vendorId: "true-value",
        vendorSku: "123456",
        unitCost: 5.25,
        supplierOffers: []
      }
    ]
  };
  const alignment = alignPurchaseOrderLinesToVendor(po, { id: "true-value", name: "True Value" }, { user: "Test buyer", now: "2026-11-25T12:00:00.000Z" });
  assert.equal(po.items[0].supplier, "True Value");
  assert.equal(po.items[0].vendorSku, "250602");
  assert.equal(po.items[0].unitCost, 9.34, "supplier alignment must not rewrite reviewed PO accounting costs");
  assert.equal(po.items[0].supplierAssignmentReviewRequired, false);
  assert.equal(po.items[1].supplier, "True Value");
  assert.equal(po.items[1].vendorSku, "", "a prior supplier SKU must not remain after choosing another supplier");
  assert.equal(po.items[1].supplierAssignmentReviewRequired, true);
  assert.equal(po.items[2].vendorSku, "123456", "saving an unchanged supplier must preserve an existing supplier SKU");
  assert.equal(po.items[2].supplierAssignmentReviewRequired, false);
  assert.equal(alignment.reviewLines.length, 1);
}

console.log("Purchase-order demand linking checks passed.");
