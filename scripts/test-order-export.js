const assert = require("assert");
const {
  orderExportHeaders,
  orderExportRows,
  orderLabelStatus,
  orderReturnStatus,
  orderShippingStatus
} = require("../lib/order-export");

const order = {
  id: "order-1",
  orderNumber: "55577",
  channelSource: "Shopify",
  channelOrderNumber: "#1042",
  orderDate: "2026-10-29T10:00:00.000Z",
  status: "fulfilled",
  financialStatus: "Paid",
  total: 45,
  paidAmount: 45,
  refundAmount: 5,
  refundedAt: "2026-10-30T10:00:00.000Z",
  returnNumber: "RET-00001",
  returnRequestedAt: "2026-10-30T09:00:00.000Z",
  shippingAddress: { city: "Brooklyn", state: "NY", postalCode: "11201", countryCode: "US" },
  purchaseOrderNumbers: ["PO-100"],
  shipments: [{
    status: "shipped",
    carrier: "UPS",
    trackingNumber: "1Z999",
    labelCost: 12.25,
    labelPurchaseId: "label-1",
    labelPrintedAt: "2026-10-29T11:00:00.000Z"
  }],
  items: [{
    lineId: "line-1",
    lineIndex: 0,
    sku: "SKU-1",
    originalSku: "SOURCE-1",
    mappedSku: "SKU-1",
    title: "Test item",
    brand: "Example Brand",
    supplier: "True Value",
    qty: 2,
    price: 20,
    cost: 8,
    refundedQty: 1,
    refundedAt: "2026-10-30T10:00:00.000Z"
  }]
};

assert.equal(orderLabelStatus(order), "Label printed");
assert.equal(orderShippingStatus(order), "Shipped");
assert.equal(orderReturnStatus(order), "Requested");

const summaryHeaders = orderExportHeaders("summary");
const summaryRows = orderExportRows(order, "summary");
assert.equal(summaryRows.length, 1);
assert.equal(summaryRows[0].length, summaryHeaders.length);
assert.equal(summaryRows[0][summaryHeaders.indexOf("Internal order number")], "55577");
assert.equal(summaryRows[0][summaryHeaders.indexOf("Label status")], "Label printed");

const lineHeaders = orderExportHeaders("lines");
const lineRows = orderExportRows(order, "lines");
assert.equal(lineRows.length, 1);
assert.equal(lineRows[0].length, lineHeaders.length);
assert.equal(lineRows[0][lineHeaders.indexOf("Brand")], "Example Brand");
assert.equal(lineRows[0][lineHeaders.indexOf("Supplier")], "True Value");
assert.equal(lineRows[0][lineHeaders.indexOf("Line total")], 40);
assert.equal(lineRows[0][lineHeaders.indexOf("Refunded quantity")], 1);

const emptyLineRows = orderExportRows({ ...order, items: [] }, "lines");
assert.equal(emptyLineRows.length, 1, "line exports retain orders that have no normalized lines");
assert.equal(emptyLineRows[0].length, lineHeaders.length);

console.log("order export tests passed");
