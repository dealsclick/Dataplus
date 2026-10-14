const assert = require("node:assert/strict");
const { fulfillmentWorkRows, fulfillmentRowIsPending, fulfillmentShipmentHistoryFallbackRows, activeFulfillmentLabelBatchAssignments, labelBatchAssignmentHidesPending, shipmentHasUsableShippingLabel, removeUnusableTemuLabelPlaceholders, temuShipmentState, temuShippingPackageSnsForOrder, existingTemuShippingLabel } = require("../server");

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

const marketplaceLabelOrder = structuredClone(purchaseOrder);
marketplaceLabelOrder.shipments = [{
  id: "shipment-channel-label",
  status: "label_purchased",
  provider: "temu",
  packageSnList: ["PK-TEST"],
  labelDocumentUnavailable: true,
  documents: []
}];
const [marketplaceLabel] = fulfillmentWorkRows([marketplaceLabelOrder], {}, [product], []);
assert.equal(marketplaceLabel.status, "ready_to_ship");
assert.equal(marketplaceLabel.labelReadiness.ready, true);
assert.equal(shipmentHasUsableShippingLabel(marketplaceLabelOrder.shipments[0]), false);
assert.deepEqual(removeUnusableTemuLabelPlaceholders(marketplaceLabelOrder.shipments), []);

const activeAssignments = activeFulfillmentLabelBatchAssignments([{
  id: "batch-active",
  batchNumber: "BATCH-1039",
  phase: "purchase",
  status: "waiting_for_labels",
  rows: [
    { orderId: marketplaceLabelOrder.id, routeIds: ["route-purchase"], status: "label_pending" },
    { orderId: "failed-order", routeIds: ["route-failed"], status: "failed", releasedAt: "2026-10-10T12:00:00.000Z" }
  ]
}]);
assert.deepEqual(activeAssignments.map(({ row }) => row.orderId), [marketplaceLabelOrder.id], "label-generating batch rows stay out of ordinary pending work while released failures return");
assert.equal(labelBatchAssignmentHidesPending({ status: "rated" }), false, "a quoted row remains visible in Pending Shipment until carrier purchase starts");
assert.equal(labelBatchAssignmentHidesPending({ status: "queued" }), false, "an unstarted purchase row remains visible in Pending Shipment");
assert.equal(labelBatchAssignmentHidesPending({ status: "processing" }), true, "a carrier purchase in progress leaves Pending Shipment");
assert.equal(labelBatchAssignmentHidesPending({ status: "label_pending" }), true, "a carrier-accepted label that is still generating leaves Pending Shipment");
assert.equal(labelBatchAssignmentHidesPending({ status: "purchased" }), true, "a purchased label leaves Pending Shipment");
assert.deepEqual(temuShippingPackageSnsForOrder({
  shipments: [{
    provider: "temu",
    status: "ready",
    trackingNumber: "",
    raw: { packageSnInfo: [{ packageSn: "PK-PLACEHOLDER", callSuccess: false }] }
  }],
  external: {
    unshippedPackage: { packageSn: "PK-UNSHIPPED" },
    combinedShipment: { packageSn: "PK-COMBINED" }
  }
}), [], "unconfirmed Temu package placeholders must not be offered as existing labels");

assert.deepEqual(temuShippingPackageSnsForOrder({
  external: { temuShipmentCreate: { success: true, result: { packageSnList: ["PK-CREATED"] } } }
}), ["PK-CREATED"], "a successfully created Temu shipment remains eligible for delayed-document recovery");

const printableLabelOrder = structuredClone(purchaseOrder);
printableLabelOrder.shipments = [{
  id: "shipment-printable-label",
  status: "label_purchased",
  provider: "temu",
  packageSnList: ["PK-PRINTABLE"],
  documents: [{ documentType: "shipping_label", documentId: "label-pdf" }]
}];
const [printableLabel] = fulfillmentWorkRows([printableLabelOrder], {}, [product], []);
assert.equal(printableLabel.status, "shipped");
assert.equal(printableLabel.shipment.id, "shipment-printable-label");
assert.equal(printableLabel.labelReadiness.ready, false);
assert.match(printableLabel.labelReadiness.blockers[0], /already/i);
assert.deepEqual(temuShippingPackageSnsForOrder(printableLabelOrder), ["PK-PRINTABLE"]);
printableLabelOrder.documents = [{
  id: "label-pdf",
  type: "shipping_label",
  storageKey: "label-pdf.pdf",
  url: "/api/orders/order-1/attachments/label-pdf"
}];
const reusableLabel = existingTemuShippingLabel(printableLabelOrder, ["PK-PRINTABLE"]);
assert.equal(reusableLabel?.shipment.id, "shipment-printable-label");
assert.equal(reusableLabel?.document.id, "label-pdf");
assert.equal(existingTemuShippingLabel(printableLabelOrder, ["PK-OTHER"]), null);

const completedOrder = structuredClone(printableLabelOrder);
completedOrder.operationalStatus = "fulfilled";
completedOrder.status = "fulfilled";
completedOrder.fulfillmentRoutes[0].status = "fulfilled";
completedOrder.shipments[0].trackingStatus = "in_transit";
completedOrder.shipments[0].shippedAt = "2026-10-08T17:18:00.000Z";
assert.equal(fulfillmentWorkRows([completedOrder], {}, [product], []).length, 0, "completed demand must remain out of Pending shipment");
const [completedShipment] = fulfillmentWorkRows([completedOrder], { includeTerminal: true }, [product], []);
assert.equal(completedShipment.status, "shipped");
assert.equal(completedShipment.operationalStatus, "fulfilled");
assert.equal(completedShipment.trackingStatus, "in_transit");
assert.equal(completedShipment.shippedAt, "2026-10-08T17:18:00.000Z");

const routeLessImportedShipment = {
  ...structuredClone(completedOrder),
  id: "route-less-order",
  orderNumber: "50043",
  fulfillmentRoutes: [],
  shipments: [
    { id: "imported-temu-shipment", status: "shipped", trackingNumber: "9200190425896615285659" },
    { id: "imported-temu-shipment", status: "shipped", trackingNumber: "9200190425896615285659" }
  ]
};
const routeLessRows = fulfillmentWorkRows([routeLessImportedShipment], { includeTerminal: true }, [product], []);
assert.equal(routeLessRows.length, 0, "shipment imports do not invent operational fulfillment routes");
const routeLessHistory = fulfillmentShipmentHistoryFallbackRows([routeLessImportedShipment], routeLessRows, [product]);
assert.equal(routeLessHistory.length, 1, "a recent imported shipment without routes receives one history-only row");
assert.equal(routeLessHistory[0].historyOnly, true);
assert.equal(routeLessHistory[0].status, "shipped");
assert.equal(routeLessHistory[0].trackingNumber, "9200190425896615285659");
assert.equal(routeLessHistory[0].orderNumber, "50043");
assert.equal(fulfillmentRowIsPending(routeLessHistory[0]), false, "shipment-history rows must never return to Pending shipment");
assert.equal(fulfillmentRowIsPending({ status: "delivered", operationalStatus: "completed" }), false, "delivered shipments must never return to Pending shipment");
assert.equal(fulfillmentRowIsPending({ status: "ready_to_ship", operationalStatus: "processing" }), true, "active fulfillment work remains pending");
const hiddenTerminalRouteHistory = fulfillmentShipmentHistoryFallbackRows([routeLessImportedShipment], [{
  id: "legacy-route",
  orderId: routeLessImportedShipment.id,
  status: "shipped",
  operationalStatus: "shipped",
  shipment: {}
}], [product]);
assert.equal(hiddenTerminalRouteHistory.length, 1, "an incomplete legacy route cannot suppress valid imported shipment history");

const walmartSummaryShipment = {
  id: "walmart-129126394119237",
  orderNumber: "45485",
  channelSource: "Walmart",
  items: [],
  shipments: [{
    id: "walmart-129126394119237-1-tracking",
    status: "delivered",
    trackingNumber: "1ZK11711YW83046122",
    lines: [{ qty: 1, sku: product.sku, lineIndex: 0, qtyFulfilled: 1 }]
  }]
};
const walmartSummaryHistory = fulfillmentShipmentHistoryFallbackRows([walmartSummaryShipment], [], [product]);
assert.equal(walmartSummaryHistory.length, 1, "a compact Walmart shipment creates one history row from shipment lines");
assert.equal(walmartSummaryHistory[0].sku, product.sku, "shipment history preserves the SKU stored on the shipment");
assert.equal(walmartSummaryHistory[0].productTitle, product.title, "shipment SKU resolves its catalog title");

const orderWithSupersededRoute = structuredClone(order);
orderWithSupersededRoute.fulfillmentRoutes.push({
  id: "route-superseded",
  type: "purchase",
  status: "superseded_by_receipt_stock",
  sku: product.sku,
  qty: 0,
  warehouseId: "warehouse-2"
});
const visibleRoutes = fulfillmentWorkRows([orderWithSupersededRoute], {}, [product], []);
assert.deepEqual(visibleRoutes.map((row) => row.id), ["route-1"], "superseded zero-unit routes must not appear in fulfillment");

const partiallyFulfilledOrder = structuredClone(order);
partiallyFulfilledOrder.items = [
  { sku: product.sku, title: product.title, qty: 1, fulfilledQty: 1, remainingQty: 0, fulfillmentStatus: "fulfilled" },
  { sku: "BUS-OPEN", title: "Open item", qty: 2, fulfilledQty: 0, remainingQty: 2, fulfillmentStatus: "ready" }
];
partiallyFulfilledOrder.fulfillmentRoutes = [
  { ...partiallyFulfilledOrder.fulfillmentRoutes[0], id: "route-fulfilled", lineIndex: 0 },
  { ...partiallyFulfilledOrder.fulfillmentRoutes[0], id: "route-open", lineIndex: 1, sku: "BUS-OPEN", qty: 2 }
];
const openPartialRows = fulfillmentWorkRows([partiallyFulfilledOrder], {}, [product], []);
assert.deepEqual(openPartialRows.map((row) => row.id), ["route-open"], "fully fulfilled lines must not return to Pending shipment");
const allPartialRows = fulfillmentWorkRows([partiallyFulfilledOrder], { includeTerminal: true }, [product], []);
assert.equal(allPartialRows.find((row) => row.id === "route-fulfilled")?.status, "fulfilled", "fulfilled lines remain visible as history");

assert.deepEqual(temuShipmentState(false, "ready", "ready"), { status: "ready", confirmed: false });
assert.deepEqual(temuShipmentState(false, "shipped", "ready"), { status: "shipped", confirmed: true });
assert.deepEqual(temuShipmentState(true, "ready", "ready"), { status: "fulfilled", confirmed: true });

console.log("Fulfillment queue classification tests passed.");
