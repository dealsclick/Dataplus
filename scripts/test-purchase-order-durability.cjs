const assert = require("node:assert/strict");
const {
  purchaseOrderAllowsDraftRecalculation,
  purchaseOrderHasSupplierCommitment,
  refreshPurchaseOrderCutoffStates,
  restorePurchaseOrderStatusFromEvidence,
  rejectPurchaseOrder,
} = require("../server");
const { purchaseOrderStatusWouldRegress } = require("../db");

assert.equal(purchaseOrderAllowsDraftRecalculation({ status: "draft" }), true);
assert.equal(purchaseOrderAllowsDraftRecalculation({ status: "draft", submittedAt: "2026-09-28T12:00:00.000Z" }), false);
assert.equal(purchaseOrderAllowsDraftRecalculation({ status: "vendor_confirmed" }), false);
assert.equal(purchaseOrderHasSupplierCommitment({ status: "in_transit" }), true);
assert.equal(purchaseOrderHasSupplierCommitment({ status: "shipped" }), true);
assert.equal(purchaseOrderHasSupplierCommitment({ status: "draft", vendorAcknowledgement: { acknowledgedAt: "2026-09-28T12:00:00.000Z" } }), true);

const submitted = { status: "draft", submittedAt: "2026-09-28T12:00:00.000Z", timeline: [] };
assert.equal(restorePurchaseOrderStatusFromEvidence(submitted), true);
assert.equal(submitted.status, "submitted");
assert.equal(submitted.workflowStage, "awaiting_tracking");

const acknowledged = { status: "ready_to_send", vendorAcknowledgement: { acknowledgedAt: "2026-09-28T13:00:00.000Z" }, timeline: [] };
assert.equal(restorePurchaseOrderStatusFromEvidence(acknowledged), true);
assert.equal(acknowledged.status, "vendor_confirmed");

const inTransit = { status: "draft", trackingNumber: "1ZTEST", type: "customer_demand", timeline: [] };
assert.equal(restorePurchaseOrderStatusFromEvidence(inTransit), true);
assert.equal(inTransit.status, "in_transit");

const dropship = { status: "draft", trackingNumber: "TRACK", type: "dropship", timeline: [] };
assert.equal(restorePurchaseOrderStatusFromEvidence(dropship), true);
assert.equal(dropship.status, "shipped");

const received = { status: "draft", items: [{ qty: 2, receivedQty: 2 }], timeline: [] };
assert.equal(restorePurchaseOrderStatusFromEvidence(received), true);
assert.equal(received.status, "received");

const progressed = { id: "po-progressed", type: "customer_demand", status: "in_transit", trackingNumber: "1ZTEST", timeline: [] };
const unchanged = refreshPurchaseOrderCutoffStates({ purchaseOrders: [progressed], vendors: [] }, new Date("2026-09-28T14:00:00.000Z"));
assert.equal(progressed.status, "in_transit");
assert.equal(unchanged.length, 0);

const manuallyReopened = { id: "po-reopened", type: "customer_demand", status: "draft", workflowStage: "waiting_for_po", manualDraftHold: true, readyForReview: false, poolDate: "2026-09-28", cutoffTime: "09:00", cutoffTimezone: "America/New_York", items: [], approval: { required: true, status: "pending" }, timeline: [] };
refreshPurchaseOrderCutoffStates({ purchaseOrders: [manuallyReopened], vendors: [] }, new Date("2026-09-28T14:00:00.000Z"));
assert.equal(manuallyReopened.status, "draft", "a manually reopened PO stays in Draft after cutoff");
assert.equal(manuallyReopened.workflowStage, "waiting_for_po");
assert.equal(manuallyReopened.readyForReview, false);

assert.equal(purchaseOrderStatusWouldRegress("submitted", "draft"), true);
assert.equal(purchaseOrderStatusWouldRegress("vendor_confirmed", "submitted"), true);
assert.equal(purchaseOrderStatusWouldRegress("in_transit", "ready_to_send"), true);
assert.equal(purchaseOrderStatusWouldRegress("received", "partially_received"), true);
assert.equal(purchaseOrderStatusWouldRegress("closed", "draft"), true);
assert.equal(purchaseOrderStatusWouldRegress("submitted", "vendor_confirmed"), false);
assert.equal(purchaseOrderStatusWouldRegress("partially_received", "received"), false);

const rejectedPo = { id: "po-reject", poNumber: "PO#REJECT", status: "awaiting_approval", items: [{ orderId: "order-reject", routeId: "route-reject" }], timeline: [] };
const rejectedOrder = { id: "order-reject", status: "paid", purchaseOrderIds: ["po-reject"], items: [{ sku: "TEST", qty: 1 }], fulfillmentRoutes: [{ id: "route-reject", type: "purchase", status: "waiting_for_po", purchaseOrderId: "po-reject", purchaseOrderNumber: "PO#REJECT", qty: 1 }] };
const rejection = rejectPurchaseOrder(rejectedPo, [rejectedOrder], { disposition: "return_to_sourcing", note: "Choose another supplier", user: "Test Buyer" });
assert.equal(rejection.purchaseOrder.status, "rejected");
assert.equal(rejectedOrder.fulfillmentRoutes[0].status, "buyer_review");
assert.equal(rejectedOrder.fulfillmentRoutes[0].purchaseOrderId, "");
assert.deepEqual(rejectedOrder.purchaseOrderIds, []);
assert.equal(rejectedPo.approval.rejectionDisposition, "return_to_sourcing");
assert.throws(() => rejectPurchaseOrder({ id: "missing-disposition", timeline: [] }, [], { note: "Missing choice" }), /Choose what should happen/);

const externalPo = { id: "po-external", poNumber: "PO#EXTERNAL", status: "draft", items: [{ orderId: "order-external", routeId: "route-external" }], timeline: [] };
const externalOrder = { id: "order-external", status: "paid", purchaseOrderIds: ["po-external"], items: [{ sku: "TEST", qty: 1 }], fulfillmentRoutes: [{ id: "route-external", type: "purchase", status: "waiting_for_po", purchaseOrderId: "po-external", purchaseOrderNumber: "PO#EXTERNAL", qty: 1 }] };
const externalPlacement = rejectPurchaseOrder(externalPo, [externalOrder], { disposition: "external_source", sourceSystem: "CTech", externalPoNumber: "D188435", user: "Test Buyer" });
assert.equal(externalPlacement.externallyPlaced, true);
assert.equal(externalPo.status, "placed");
assert.equal(externalPo.workflowStage, "awaiting_tracking");
assert.equal(externalPo.externalSourceSystem, "CTech");
assert.equal(externalPo.externalPoNumber, "D188435");
assert.equal(externalPo.ctechId, "D188435");
assert.equal(externalOrder.fulfillmentRoutes[0].status, "po_placed");
assert.equal(externalOrder.fulfillmentRoutes[0].purchaseOrderId, "po-external");
assert.deepEqual(externalOrder.purchaseOrderIds, ["po-external"]);
assert.throws(() => rejectPurchaseOrder({ id: "external-missing-reference", timeline: [] }, [], { disposition: "external_source", sourceSystem: "CTech" }), /external PO number/i);

console.log("Purchase-order durability tests passed.");
