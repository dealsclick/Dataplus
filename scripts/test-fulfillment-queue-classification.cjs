const assert = require("node:assert/strict");
const { fulfillmentWorkRows, shipmentHasUsableShippingLabel, removeUnusableTemuLabelPlaceholders, temuShipmentState, temuShippingPackageSnsForOrder, existingTemuShippingLabel } = require("../server");

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

assert.deepEqual(temuShipmentState(false, "ready", "ready"), { status: "ready", confirmed: false });
assert.deepEqual(temuShipmentState(false, "shipped", "ready"), { status: "shipped", confirmed: true });
assert.deepEqual(temuShipmentState(true, "ready", "ready"), { status: "fulfilled", confirmed: true });

console.log("Fulfillment queue classification tests passed.");
