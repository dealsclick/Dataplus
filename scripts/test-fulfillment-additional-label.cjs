const assert = require("node:assert/strict");

const {
  batchSummary,
  fulfillmentBatchAdditionalLabelRow,
  publicFulfillmentAdditionalLabel
} = require("../server.js");

const batch = {
  id: "batch-1",
  batchNumber: "BATCH-1173",
  rows: [
    { id: "row-1", orderId: "order-1", shipmentId: "shipment-1", status: "purchased", rates: [], selectedRate: null },
    { id: "row-2", orderId: "order-2", shipmentId: "shipment-2", status: "purchased", rates: [], selectedRate: null }
  ],
  additionalLabelQuote: { id: "legacy-quote", rates: [{ raw: { request_token: "secret" } }] },
  additionalLabelQuotes: [{ id: "quote-1", rates: [{ raw: { request_token: "secret" } }] }],
  additionalLabels: [{
    id: "extra-1",
    rowId: "row-1",
    orderId: "order-1",
    orderNumber: "88317",
    shipmentId: "shipment-1",
    package: { weight: 5, length: 10, width: 8, height: 6 },
    carrier: "UPS",
    service: "Ground",
    trackingNumber: "1ZEXTRA",
    documentId: "document-1",
    documentUrl: "/api/orders/order-1/attachments/document-1",
    remoteShipmentId: "private-remote-id",
    rawSummary: { requestToken: "secret" },
    channelSyncSuppressed: true
  }]
};

const summary = batchSummary(batch);
assert.equal(summary.additionalLabelQuote, undefined);
assert.equal(summary.additionalLabelQuotes, undefined);
assert.equal(summary.additionalLabels.length, 1);
assert.equal(summary.additionalLabels[0].trackingNumber, "1ZEXTRA");
assert.equal(summary.additionalLabels[0].channelSyncSuppressed, true);
assert.equal(summary.additionalLabels[0].remoteShipmentId, undefined);
assert.equal(summary.additionalLabels[0].rawSummary, undefined);

assert.equal(fulfillmentBatchAdditionalLabelRow(batch, { rowId: "row-1" }).shipmentId, "shipment-1");
assert.equal(fulfillmentBatchAdditionalLabelRow(batch, { shipmentId: "shipment-2" }).orderId, "order-2");
assert.equal(fulfillmentBatchAdditionalLabelRow(batch, { orderId: "order-1" }).id, "row-1");
assert.equal(fulfillmentBatchAdditionalLabelRow({ rows: [{ id: "a", orderId: "same" }, { id: "b", orderId: "same" }] }, { orderId: "same" }), null);

const publicLabel = publicFulfillmentAdditionalLabel(batch.additionalLabels[0]);
assert.equal(publicLabel.documentUrl, "/api/orders/order-1/attachments/document-1");
assert.equal(publicLabel.remoteShipmentId, undefined);

console.log("Fulfillment additional-label tests passed.");
