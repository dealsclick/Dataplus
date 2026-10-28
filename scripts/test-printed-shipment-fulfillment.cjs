const assert = require("node:assert/strict");
const { applyPrintedShipmentFulfillment } = require("../lib/printed-shipment-fulfillment");

const order = {
  id: "shopify-order-1",
  orderNumber: "55577",
  source: "Shopify",
  status: "processing",
  fulfillmentStatus: "UNFULFILLED",
  operationalStatus: "waiting_for_po",
  items: [{ sku: "BUS153556TRV", qty: 1, fulfilledQty: 0, remainingQty: 1 }],
  fulfillmentRoutes: [{ lineIndex: 0, sku: "BUS153556TRV", qty: 1, type: "purchase", status: "submitted", warehouseId: "warehouse-1" }]
};
const shipment = {
  id: "shipment-1",
  status: "label_purchased",
  carrier: "UPS",
  carrierName: "UPS",
  service: "UPS Ground Saver",
  trackingNumber: "1ZTEST",
  lines: [{ lineIndex: 0, sku: "BUS153556TRV", qty: 1 }]
};

const completedAt = "2026-10-28T18:00:00.000Z";
const result = applyPrintedShipmentFulfillment(order, shipment, { actor: "Warehouse", completedAt });
assert.equal(result.status, "completed");
assert.equal(result.fullyFulfilled, true);
assert.deepEqual(result.completedLines, [{ lineIndex: 0, sku: "BUS153556TRV", qty: 1 }]);
assert.equal(order.status, "fulfilled");
assert.equal(order.fulfillmentStatus, "fulfilled");
assert.equal(order.operationalStatus, "completed");
assert.equal(order.items[0].fulfilledQty, 1);
assert.equal(order.items[0].remainingQty, 0);
assert.equal(order.fulfillmentLines[0].qtyFulfilled, 1);
assert.equal(order.fulfillmentRoutes[0].status, "shipped");
assert.equal(shipment.status, "fulfilled");
assert.equal(shipment.lines[0].qtyAllocated, 1);
assert.equal(shipment.lines[0].qtyFulfilled, 1);
assert.equal(shipment.printFulfillment.status, "completed");

const repeated = applyPrintedShipmentFulfillment(order, shipment, { actor: "Warehouse", completedAt: "2026-10-28T18:05:00.000Z" });
assert.equal(repeated.status, "already_completed");
assert.equal(repeated.changed, false);
assert.equal(order.fulfillmentLines[0].qtyFulfilled, 1);

const partialOrder = {
  id: "shopify-order-2",
  items: [{ sku: "SKU-2", qty: 3, fulfilledQty: 0, remainingQty: 3 }],
  fulfillmentRoutes: [{ lineIndex: 0, sku: "SKU-2", qty: 3, type: "warehouse", status: "packed" }]
};
const partialShipment = { id: "shipment-2", status: "label_purchased", trackingNumber: "1ZPARTIAL", lines: [{ lineIndex: 0, sku: "SKU-2", qty: 2 }] };
const partial = applyPrintedShipmentFulfillment(partialOrder, partialShipment, { completedAt });
assert.equal(partial.fullyFulfilled, false);
assert.equal(partialOrder.status, "partial_fulfilled");
assert.equal(partialOrder.items[0].fulfilledQty, 2);
assert.equal(partialOrder.items[0].remainingQty, 1);
assert.equal(partialOrder.fulfillmentRoutes[0].status, "packed");

console.log("Printed shipment fulfillment tests passed.");
