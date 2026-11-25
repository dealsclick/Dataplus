const assert = require("node:assert/strict");

const {
  normalizeManualPurchaseOrderItems,
  updatePurchaseOrderLineCost,
  validatePurchaseOrderBackorders,
  applyPurchaseOrderReceiptBackorders,
  reserveSupplierFreeItemLots,
  releaseSupplierFreeItemLotAssignments,
  consumeSupplierFreeItemLotAssignments
} = require("../server.js");

const [normalizedFreeLine] = normalizeManualPurchaseOrderItems([{
  sku: "FREE-1",
  title: "Supplier bonus item",
  qty: 4,
  estimatedUnitCost: 19.99,
  isFreeItem: true
}]);
assert.equal(normalizedFreeLine.estimatedUnitCost, 0);
assert.equal(normalizedFreeLine.unitCost, 0);
assert.equal(normalizedFreeLine.isFreeItem, true);
assert.equal(normalizedFreeLine.costSource, "supplier_free_item");
assert.equal(normalizedFreeLine.costStatus, "confirmed");

const po = {
  id: "po-free",
  poNumber: "PO-FREE",
  status: "in_transit",
  items: [{ id: "line-free", routeId: "purchase-route", orderId: "order-free", sku: "FREE-1", title: "Supplier bonus item", qty: 4, receivedQty: 0, estimatedUnitCost: 19.99 }]
};
const order = {
  id: "order-free",
  orderNumber: "1001",
  items: [{ sku: "FREE-1", title: "Supplier bonus item", qty: 4, unitCost: 19.99 }],
  fulfillmentRoutes: [{ id: "purchase-route", lineIndex: 0, type: "purchase", sku: "FREE-1", qty: 4, purchaseOrderId: "po-free" }]
};
const freeResult = updatePurchaseOrderLineCost(po, [order], null, {
  routeId: "purchase-route",
  unitCost: 19.99,
  isFreeItem: true,
  freeItemReason: "Free after supplier minimum",
  user: "Buyer"
});
assert.equal(freeResult.line.unitCost, 0);
assert.equal(freeResult.line.isFreeItem, true);
assert.equal(order.items[0].unitCost, 0);
assert.equal(order.items[0].costSource, "supplier_free_item");
assert.equal(order.fulfillmentRoutes[0].isFreeItem, true);

const receivingPo = {
  id: "po-backorder",
  poNumber: "PO-BACKORDER",
  items: [
    { id: "line-a", routeId: "route-a", sku: "SKU-A", title: "Item A", qty: 10, receivedQty: 4 },
    { id: "line-b", routeId: "route-b", sku: "SKU-B", title: "Item B", qty: 5, receivedQty: 0 }
  ]
};
assert.equal(validatePurchaseOrderBackorders(receivingPo, [{ purchaseOrderLineId: "line-a", qtyReceived: 2 }], [{ purchaseOrderLineId: "line-a", qtyBackordered: 4 }]), "");
assert.match(validatePurchaseOrderBackorders(receivingPo, [{ purchaseOrderLineId: "line-a", qtyReceived: 2 }], [{ purchaseOrderLineId: "line-a", qtyBackordered: 5 }]), /only 4 remain/);

receivingPo.items[0].receivedQty += 2;
const receipt = { id: "receipt-1", receiptNumber: "RCV-0001" };
const backorder = applyPurchaseOrderReceiptBackorders(receivingPo, [
  { purchaseOrderLineId: "line-a", qtyBackordered: 4 },
  { purchaseOrderLineId: "line-b", qtyBackordered: 5 }
], receipt, { user: "Receiver", note: "Supplier will ship next week" });
assert.equal(backorder.totalUnits, 9);
assert.equal(receivingPo.hasBackorderedItems, true);
assert.equal(receivingPo.items[0].supplierDisposition, "backordered");
assert.equal(receipt.backorder.totalUnits, 9);

receivingPo.items[0].receivedQty = 9;
const reduced = applyPurchaseOrderReceiptBackorders(receivingPo, [], receipt, { user: "Receiver" });
assert.equal(receivingPo.items[0].backorderedQty, 1);
assert.equal(reduced.totalUnits, 6);

const product = {
  sku: "FREE-1",
  inventoryCostLots: [{
    id: "lot-free",
    receiptId: "receipt-free",
    receiptNumber: "RCV-FREE",
    warehouseId: "warehouse-1",
    quantityAvailable: 4,
    availableQty: 4,
    isFreeItem: true,
    freeItemReason: "Free after supplier minimum"
  }]
};
const reserved = reserveSupplierFreeItemLots(product, { id: "warehouse-1" }, 3, { preferredReceiptId: "receipt-free" });
assert.equal(reserved.quantity, 3);
assert.equal(reserved.assignments[0].receiptNumber, "RCV-FREE");
assert.equal(product.inventoryCostLots[0].availableQty, 1);
assert.equal(product.inventoryCostLots[0].reservedQty, 3);

const released = releaseSupplierFreeItemLotAssignments(product, reserved.assignments, 1);
assert.equal(released.quantity, 1);
assert.equal(product.inventoryCostLots[0].availableQty, 2);
assert.equal(product.inventoryCostLots[0].reservedQty, 2);
assert.equal(reserved.assignments[0].releasedQty, 1);

const consumed = consumeSupplierFreeItemLotAssignments(product, reserved.assignments, 2);
assert.equal(consumed.quantity, 2);
assert.equal(product.inventoryCostLots[0].availableQty, 2);
assert.equal(product.inventoryCostLots[0].reservedQty, 0);
assert.equal(product.inventoryCostLots[0].consumedQty, 2);
assert.equal(reserved.assignments[0].consumedQty, 2);

console.log("purchase-order free item and backorder tests passed");
