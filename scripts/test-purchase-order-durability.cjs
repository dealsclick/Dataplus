const assert = require("node:assert/strict");
const {
  purchaseOrderAllowsDraftRecalculation,
  purchaseOrderHasSupplierCommitment,
  refreshPurchaseOrderCutoffStates,
  restorePurchaseOrderStatusFromEvidence,
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

assert.equal(purchaseOrderStatusWouldRegress("submitted", "draft"), true);
assert.equal(purchaseOrderStatusWouldRegress("vendor_confirmed", "submitted"), true);
assert.equal(purchaseOrderStatusWouldRegress("in_transit", "ready_to_send"), true);
assert.equal(purchaseOrderStatusWouldRegress("received", "partially_received"), true);
assert.equal(purchaseOrderStatusWouldRegress("closed", "draft"), true);
assert.equal(purchaseOrderStatusWouldRegress("submitted", "vendor_confirmed"), false);
assert.equal(purchaseOrderStatusWouldRegress("partially_received", "received"), false);

console.log("Purchase-order durability tests passed.");
